import { checkPublicQuery } from "./publicQuery";
import { doctorsFromRows, type DoctorRow } from "./doctors";
import { lookup2gis } from "./places2gis";
import { KB, retrieve, type Lang } from "./kb";
import { triage, emergencyMessage } from "./triage";
import { verifyInitData } from "./telegram";
import { askGemini, buildSystemPrompt, citedSources, offlineAnswer, type ChatTurn } from "./gemini";
import { fetchFacilities, parseFacilityQuery } from "./overpass";
import { detectIntent } from "./intent";
import { localDate } from "./time";
import {
  BookingError,
  bookSlot,
  cancelByPatient,
  checkDateInWindow,
  listClinics,
  listSlots,
  myAppointments,
  getAppointment,
  getDoctor,
  publicAppointment,
  queueInfo,
  type Patient,
} from "./booking";
import { applyAction, auditLog, authStaff, checkInByCode, daySchedule, publishDirectory, setDelay, walkInBooking, type Action } from "./staff";
import { acceptOffer, joinWaitlist, leaveWaitlist, myWaitlist, offerMessage, reconcileAll, reconcileWaitlist, type Offer } from "./waitlist";
import { pickVoice, STT_LANGS, synthesize, transcribe, voicelabChat, VoiceLabError, type SttLang } from "./voicelab";

export interface Env {
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
  DB?: D1Database;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_FALLBACK_MODEL?: string;
  LLM_PROVIDER?: string; // "gemini" (по умолчанию) | "voicelab"
  VOICELAB_API_KEY?: string;
  VOICELAB_BASE_URL?: string;
  VOICELAB_LLM_MODEL?: string;
  VOICELAB_VOICE_UZ?: string;
  VOICELAB_VOICE_RU?: string;
  BOT_TOKEN?: string;
  REQUIRE_TELEGRAM?: string; // "true" — пациенты только из Telegram
  WEBAPP_URL?: string;
  TG_WEBHOOK_SECRET?: string;
  OVERPASS_URL?: string;
  ALLOWED_ORIGIN?: string;
  /** Explicit operator approval after legal review and proof of Uzbek hosting. */
  PATIENT_DATA_HOST_APPROVED?: string;
  /** Off by default: the client runs health chat on-device to avoid sending symptoms to the server. */
  SERVER_HEALTH_CHAT_ENABLED?: string;
  /** Off by default: medical chat text must not be sent to foreign LLM providers. */
  EXTERNAL_AI_TRANSFER_APPROVED?: string;
  /** Off by default: voice/audio may contain sensitive health data. */
  EXTERNAL_VOICE_TRANSFER_APPROVED?: string;
  /** Ключ 2GIS Places API для онлайн-справки (часы, рейтинг). Секрет: `wrangler secret put DGIS_KEY`. */
  DGIS_KEY?: string;
}

const MAX_MSG = 1000;
const MAX_TURNS = 8;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_TTS_CHARS = 600;

// Лимит запросов в памяти одного экземпляра Worker — достаточно для демо.
const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimited(key: string, limit = 20, windowMs = 60000, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
    return false;
  }
  b.n++;
  return b.n > limit;
}

function json(data: unknown, status = 200, env?: Env, extra: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": env?.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data, X-Demo-Patient, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      ...extra,
    },
  });
}

function parseLang(v: unknown): Lang {
  return v === "uz" ? "uz" : "ru";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Кто пациент: подпись Telegram, а вне Telegram (только если разрешено) — демо-идентификатор устройства. */
export async function identifyPatient(req: Request, env: Env): Promise<Patient | null> {
  const initData = req.headers.get("X-Telegram-Init-Data") ?? "";
  if (env.BOT_TOKEN && initData) {
    const r = await verifyInitData(initData, env.BOT_TOKEN);
    if (r.ok && r.userId) {
      const label = [r.firstName ?? "Telegram", r.lastName ? `${r.lastName[0]}.` : ""].join(" ").trim();
      return { key: `tg:${r.userId}`, label, channel: "telegram" };
    }
    return null;
  }
  if (env.REQUIRE_TELEGRAM === "true") return null;
  const demo = req.headers.get("X-Demo-Patient") ?? "";
  if (UUID.test(demo)) return { key: `demo:${demo.toLowerCase()}`, label: `Демо-пациент ${demo.slice(-4).toUpperCase()}`, channel: "demo" };
  return null;
}

async function authorizeChat(req: Request, env: Env): Promise<{ ok: boolean; key: string }> {
  const initData = req.headers.get("X-Telegram-Init-Data") ?? "";
  const ip = req.headers.get("CF-Connecting-IP") ?? "local";
  if (env.BOT_TOKEN && initData) {
    const r = await verifyInitData(initData, env.BOT_TOKEN);
    return r.ok ? { ok: true, key: `u:${r.userId ?? ip}` } : { ok: false, key: ip };
  }
  if (env.REQUIRE_TELEGRAM === "true") return { ok: false, key: ip };
  return { ok: true, key: `ip:${ip}` };
}

export interface ChatBody {
  messages: ChatTurn[];
  lang: Lang;
}

export function validateChatBody(raw: unknown): ChatBody | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { messages?: unknown; lang?: unknown };
  if (!Array.isArray(r.messages) || r.messages.length === 0) return null;
  const msgs: ChatTurn[] = [];
  for (const m of r.messages.slice(-MAX_TURNS)) {
    if (!m || typeof m !== "object") return null;
    const { role, text } = m as { role?: unknown; text?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") return null;
    const t = text.trim().slice(0, MAX_MSG);
    if (t) msgs.push({ role, text: t });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return null;
  return { messages: msgs, lang: parseLang(r.lang) };
}

async function askLlm(env: Env, system: string, messages: ChatTurn[], fetchImpl?: typeof fetch): Promise<string | null> {
  if (env.LLM_PROVIDER === "voicelab") {
    if (!env.VOICELAB_API_KEY || !env.VOICELAB_LLM_MODEL) return null;
    return voicelabChat({ apiKey: env.VOICELAB_API_KEY, baseUrl: env.VOICELAB_BASE_URL, fetchImpl }, env.VOICELAB_LLM_MODEL, system, messages);
  }
  if (!env.GEMINI_API_KEY) return null;
  return askGemini(system, messages, {
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    fallbackModel: env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-lite",
    fetchImpl,
  });
}

export async function handleChat(body: ChatBody, env: Env, fetchImpl?: typeof fetch) {
  const { messages, lang } = body;
  const last = messages[messages.length - 1].text;
  const t = triage(last);
  if (t.emergency) {
    const em = KB.find((k) => k.id === "emergency")!;
    return {
      emergency: true,
      answer: emergencyMessage(lang, t.selfHarm),
      sources: [{ id: em.id, title: em.title[lang], url: em.url, official: em.official }],
      mode: "triage" as const,
      intent: null,
    };
  }
  const intent = detectIntent(last);
  const userContext = messages.filter((m) => m.role === "user").slice(-3).map((m) => m.text).join(" ");
  const direct = retrieve(last);
  const sources = direct.length ? direct : retrieve(userContext);

  let answer: string | null = null;
  let mode: "ai" | "offline" = "offline";
  // Medical conversations may contain special personal data. Do not transmit them
  // to Gemini/VoiceLab unless the operator has completed a separate legal review.
  if (sources.length && env.EXTERNAL_AI_TRANSFER_APPROVED === "true") {
    try {
      answer = await askLlm(env, buildSystemPrompt(lang, sources), messages, fetchImpl);
      if (answer) mode = "ai";
    } catch (e) {
      console.error("llm_failed", (e as Error).message);
    }
  }
  if (!answer) {
    answer =
      intent && !sources.length
        ? lang === "uz"
          ? "Quyidagi tugma orqali ulangan klinikalardagi bo‘sh vaqtni ko‘rishingiz mumkin. Qaysi shifokor kerakligini bilmasangiz, oilaviy shifokordan boshlang."
          : "Свободное время в подключённых клиниках можно посмотреть по кнопке ниже. Если не знаете, какой специалист нужен, начните с семейного врача (терапевта)."
        : offlineAnswer(lang, sources);
  }
  const used = mode === "ai" ? citedSources(answer, sources) : sources.slice(0, 2);
  return {
    emergency: false,
    answer,
    sources: used.map((s) => ({ id: s.id, title: s.title[lang], url: s.url, official: s.official, checked: s.checked })),
    mode,
    intent,
  };
}

async function handleBotWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.BOT_TOKEN || !env.WEBAPP_URL) return new Response("not configured", { status: 503 });
  if (env.TG_WEBHOOK_SECRET && req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TG_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const update = (await req.json().catch(() => null)) as { message?: { chat?: { id: number }; text?: string; from?: { language_code?: string } } } | null;
  const msg = update?.message;
  if (msg?.chat?.id && typeof msg.text === "string" && msg.text.startsWith("/start")) {
    const uz = msg.from?.language_code === "uz";
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: msg.chat.id,
        text: uz
          ? "BepulMed AI — klinika topish, shifokorga yozilish va navbat. Ilovani oching 👇\nShoshilinch holatda: 103 yoki 112."
          : "BepulMed AI — поиск клиник, запись к врачу и очередь. Откройте приложение 👇\nВ экстренной ситуации: 103 или 112.",
        reply_markup: { inline_keyboard: [[{ text: uz ? "Ilovani ochish" : "Открыть приложение", web_app: { url: env.WEBAPP_URL } }]] },
      }),
    });
  }
  return new Response("ok");
}

async function readJson(req: Request, maxBytes = 20000): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get("Content-Length") ?? 0) > maxBytes) return null;
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Уведомление в Telegram о предложенном времени. Без бота или для демо-пациента — ничего не делает. */
export async function notifyOffers(env: Env, offers: Offer[], fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!env.BOT_TOKEN || !offers.length) return 0;
  let sent = 0;
  for (const o of offers) {
    const m = /^tg:(\d+)$/.exec(o.patientKey);
    if (!m) continue;
    try {
      const r = await fetchImpl(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: Number(m[1]),
          text: `${offerMessage(o, "uz")}\n\n${offerMessage(o, "ru")}`, // язык пациента не храним — шлём на двух
          ...(env.WEBAPP_URL ? { reply_markup: { inline_keyboard: [[{ text: "Подтвердить / Tasdiqlash", web_app: { url: env.WEBAPP_URL } }]] } } : {}),
        }),
      });
      if (r.ok) sent++;
    } catch (e) {
      console.error("notify_failed", (e as Error).message);
    }
  }
  return sent;
}

type Ctx = { waitUntil(p: Promise<unknown>): void } | undefined;

/** Обработать лист ожидания после освобождения времени и разослать уведомления (в фоне, если есть ctx). */
async function afterFreed(db: D1Database, env: Env, ctx: Ctx, doctorId: string, date: string, now: Date) {
  const offers = await reconcileWaitlist(db, doctorId, date, now);
  if (offers.length) {
    const p = notifyOffers(env, offers);
    if (ctx) ctx.waitUntil(p);
    else await p;
  }
  return offers;
}

const ACTIONS: Action[] = ["check_in", "call", "start", "finish", "no_show", "cancel"];

async function route(req: Request, env: Env, url: URL, ctx?: Ctx): Promise<Response> {
  const p = url.pathname;
  const now = new Date();

  if (p === "/api/health") {
    return json(
      {
        ok: true,
        ai: env.EXTERNAL_AI_TRANSFER_APPROVED === "true" && (env.LLM_PROVIDER === "voicelab" ? Boolean(env.VOICELAB_API_KEY && env.VOICELAB_LLM_MODEL) : Boolean(env.GEMINI_API_KEY)),
        llm: env.EXTERNAL_AI_TRANSFER_APPROVED === "true" ? (env.LLM_PROVIDER === "voicelab" ? "voicelab" : "gemini") : "offline-kb",
        voice: env.EXTERNAL_VOICE_TRANSFER_APPROVED === "true" && Boolean(env.VOICELAB_API_KEY),
        booking: Boolean(env.DB) && env.PATIENT_DATA_HOST_APPROVED === "true",
        patientDataHostApproved: env.PATIENT_DATA_HOST_APPROVED === "true",
        serverHealthChat: env.SERVER_HEALTH_CHAT_ENABLED === "true",
        telegramOnly: env.REQUIRE_TELEGRAM === "true",
        lookup: Boolean(env.DGIS_KEY),
        doctorsDirectory: Boolean(env.DB),
      },
      200,
      env,
    );
  }

  if (p === "/api/chat" && req.method === "POST") {
    if (env.SERVER_HEALTH_CHAT_ENABLED !== "true") return json({ error: "server_health_chat_disabled_use_on_device" }, 503, env);
    const auth = await authorizeChat(req, env);
    if (!auth.ok) return json({ error: "unauthorized" }, 401, env);
    if (rateLimited(`chat:${auth.key}`)) return json({ error: "rate_limited" }, 429, env);
    const body = validateChatBody(await readJson(req));
    if (!body) return json({ error: "bad_request" }, 400, env);
    return json(await handleChat(body, env), 200, env);
  }

  // Онлайн-справка: только общедоступный запрос (название/категория/район), без данных о человеке.
  if (p === "/api/lookup" && req.method === "GET") {
    const chk = checkPublicQuery({ kind: url.searchParams.get("kind") ?? "", q: url.searchParams.get("q") ?? "", district: url.searchParams.get("district") ?? undefined });
    if (!chk.ok) return json({ error: `query_${chk.reason}` }, 400, env);
    if (!env.DGIS_KEY) return json({ error: "lookup_provider_not_configured" }, 503, env);
    const ip = req.headers.get("CF-Connecting-IP") ?? "anon";
    if (rateLimited(`lookup:${ip}`, 30)) return json({ error: "rate_limited" }, 429, env);
    const q = chk.query;
    const cacheKey = new Request(`https://cache.bepulmed/lookup?k=${q.kind}&d=${q.district ?? ""}&q=${encodeURIComponent(q.q.toLowerCase())}`);
    const cache = typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null;
    const hit = cache ? await cache.match(cacheKey) : undefined;
    if (hit) return json(await hit.json(), 200, env, { "X-Cache": "HIT" });
    try {
      const places = await lookup2gis(q, env.DGIS_KEY);
      const body = { places, source: "2gis", fetchedAt: now.toISOString() };
      if (cache) ctx?.waitUntil?.(cache.put(cacheKey, new Response(JSON.stringify(body), { headers: { "Cache-Control": "max-age=21600" } })));
      return json(body, 200, env);
    } catch {
      return json({ error: "lookup_failed" }, 502, env); // без текста запроса в логах
    }
  }

  if (p === "/api/facilities" && req.method === "GET") {
    const q = parseFacilityQuery(url);
    if ("error" in q) return json(q, 400, env);
    const lang = parseLang(url.searchParams.get("lang"));
    const cacheKey = new Request(`https://cache.bepulmed/facilities?lat=${q.lat.toFixed(3)}&lon=${q.lon.toFixed(3)}&r=${q.radius}&k=${q.kinds.join(",")}&l=${lang}`);
    const cache = typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null;
    const hit = cache ? await cache.match(cacheKey) : undefined;
    if (hit) return json(await hit.json(), 200, env, { "X-Cache": "HIT" });
    let facilities;
    try {
      facilities = await fetchFacilities(q, lang, env.OVERPASS_URL || "https://overpass-api.de/api/interpreter");
    } catch (e) {
      console.error("overpass_failed", (e as Error).message);
      return json({ error: "upstream_unavailable" }, 503, env);
    }
    const payload = { facilities, source: "OpenStreetMap contributors (ODbL)", fetchedAt: now.toISOString() };
    if (cache) await cache.put(cacheKey, new Response(JSON.stringify(payload), { headers: { "Cache-Control": "max-age=3600" } }));
    return json(payload, 200, env);
  }

  // ---------- Голос (VoiceLab) ----------
  if (p === "/api/voice/stt" && req.method === "POST") {
    if (env.EXTERNAL_VOICE_TRANSFER_APPROVED !== "true") return json({ error: "external_voice_transfer_disabled" }, 503, env);
    if (!env.VOICELAB_API_KEY) return json({ error: "voice_unavailable" }, 503, env);
    const auth = await authorizeChat(req, env);
    if (!auth.ok) return json({ error: "unauthorized" }, 401, env);
    if (rateLimited(`voice:${auth.key}`, 10)) return json({ error: "rate_limited" }, 429, env);
    if (Number(req.headers.get("Content-Length") ?? 0) > MAX_AUDIO_BYTES + 10000) return json({ error: "too_large" }, 413, env);
    const form = await req.formData().catch(() => null);
    const audio = form?.get("audio");
    if (!audio || typeof audio === "string") return json({ error: "audio_required" }, 400, env);
    if (audio.size === 0 || audio.size > MAX_AUDIO_BYTES) return json({ error: "too_large" }, 413, env);
    const langRaw = String(form?.get("language") ?? "auto");
    const language: SttLang = (STT_LANGS as readonly string[]).includes(langRaw) ? (langRaw as SttLang) : "auto";
    const name = audio.type.includes("mp4") ? "voice.m4a" : audio.type.includes("ogg") ? "voice.ogg" : "voice.webm";
    try {
      const text = await transcribe({ apiKey: env.VOICELAB_API_KEY, baseUrl: env.VOICELAB_BASE_URL }, audio, name, language, crypto.randomUUID());
      return json({ text }, 200, env);
    } catch (e) {
      const ve = e instanceof VoiceLabError ? e : new VoiceLabError("voicelab_error", 502);
      console.error("stt_failed", ve.code, ve.status);
      return json({ error: ve.code }, 502, env);
    }
  }

  if (p === "/api/voice/tts" && req.method === "POST") {
    if (env.EXTERNAL_VOICE_TRANSFER_APPROVED !== "true") return json({ error: "external_voice_transfer_disabled" }, 503, env);
    if (!env.VOICELAB_API_KEY) return json({ error: "voice_unavailable" }, 503, env);
    const auth = await authorizeChat(req, env);
    if (!auth.ok) return json({ error: "unauthorized" }, 401, env);
    if (rateLimited(`tts:${auth.key}`, 10)) return json({ error: "rate_limited" }, 429, env);
    const body = await readJson(req);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text || text.length > MAX_TTS_CHARS) return json({ error: "bad_text" }, 400, env);
    const lang = parseLang(body?.lang);
    try {
      const cfg = { apiKey: env.VOICELAB_API_KEY, baseUrl: env.VOICELAB_BASE_URL };
      const voice = await pickVoice(cfg, lang, lang === "uz" ? env.VOICELAB_VOICE_UZ : env.VOICELAB_VOICE_RU);
      const wav = await synthesize(cfg, text, lang, voice, crypto.randomUUID());
      return new Response(wav, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store", "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*" } });
    } catch (e) {
      const ve = e instanceof VoiceLabError ? e : new VoiceLabError("voicelab_error", 502);
      console.error("tts_failed", ve.code, ve.status);
      return json({ error: ve.code }, 502, env);
    }
  }

  // ---------- Запись (пациент) ----------
  // Открытый справочник врачей (кто и когда принимает). Без данных пациентов — поэтому доступен
  // и при выключенной записи (PATIENT_DATA_HOST_APPROVED=false). Нужна только база с расписаниями.
  if (p === "/api/directory/doctors" && req.method === "GET") {
    const ref = url.searchParams.get("facility") ?? "";
    if (!/^[a-z0-9_-]{1,40}$/i.test(ref)) return json({ error: "bad_facility" }, 400, env);
    if (!env.DB) return json({ doctors: [], source: null }, 200, env);
    try {
      const r = await env.DB.prepare(
        `SELECT d.id, d.full_name, d.specialty, d.room, s.weekday, s.start_min, s.end_min, d.schedule_checked_at AS checked
           FROM clinics c JOIN doctors d ON d.clinic_id = c.id AND d.active = 1
           LEFT JOIN doctor_schedules s ON s.doctor_id = d.id
          WHERE c.facility_ref = ?1 ORDER BY d.specialty, d.full_name, s.weekday`,
      )
        .bind(ref)
        .all<DoctorRow & { checked: string | null }>();
      const rows = r.results ?? [];
      const checked = rows.map((x) => x.checked).filter(Boolean).sort().pop() ?? null;
      return json({ doctors: doctorsFromRows(rows), source: rows.length ? "bepulmed" : null, checkedAt: checked }, 200, env, { "Cache-Control": "public, max-age=900" });
    } catch {
      return json({ doctors: [], source: null }, 200, env); // база без миграции 0004
    }
  }

  // Регистратура публикует список врачей и часы приёма. Данных пациентов нет — работает и при выключенной записи.
  if (p === "/api/staff/directory" && req.method === "GET") {
    if (!env.DB) return json({ error: "db_unavailable" }, 503, env);
    const staff = await authStaff(env.DB, req.headers.get("Authorization"));
    if (!staff) return json({ error: "unauthorized" }, 401, env);
    const c = await env.DB.prepare("SELECT name_ru, facility_ref FROM clinics WHERE id = ?").bind(staff.clinic_id).first<{ name_ru: string; facility_ref: string | null }>();
    const r = await env.DB.prepare(
      `SELECT d.id, d.full_name, d.specialty, d.room, s.weekday, s.start_min, s.end_min FROM doctors d
         LEFT JOIN doctor_schedules s ON s.doctor_id = d.id WHERE d.clinic_id = ? AND d.active = 1 ORDER BY d.full_name, s.weekday`,
    )
      .bind(staff.clinic_id)
      .all<DoctorRow>();
    return json({ staff: { name: staff.name, role: staff.role }, clinic: { name: c?.name_ru ?? "", facilityRef: c?.facility_ref ?? null }, doctors: doctorsFromRows(r.results ?? []) }, 200, env);
  }

  if (p === "/api/staff/directory" && req.method === "PUT") {
    if (!env.DB) return json({ error: "db_unavailable" }, 503, env);
    const staff = await authStaff(env.DB, req.headers.get("Authorization"));
    if (!staff) return json({ error: "unauthorized" }, 401, env);
    try {
      return json(await publishDirectory(env.DB, staff, await readJson(req), now), 200, env);
    } catch (e) {
      if (e instanceof BookingError) return json({ error: e.code }, e.status, env);
      throw e;
    }
  }

  if (p.startsWith("/api/clinics") || p.startsWith("/api/doctors") || p.startsWith("/api/appointments") || p.startsWith("/api/staff") || p.startsWith("/api/waitlist")) {
    // Cloudflare D1/Workers are retained for demos only until a locally hosted,
    // legally reviewed patient-data backend is configured and explicitly approved.
    if (env.PATIENT_DATA_HOST_APPROVED !== "true") return json({ error: "patient_data_host_not_approved" }, 503, env);
    if (!env.DB) return json({ error: "booking_unavailable" }, 503, env);
  }
  const db = env.DB!;

  if (p === "/api/clinics" && req.method === "GET") return json({ clinics: await listClinics(db) }, 200, env);

  let m = /^\/api\/doctors\/([A-Za-z0-9_-]{1,64})\/slots$/.exec(p);
  if (m && req.method === "GET") {
    const date = checkDateInWindow(url.searchParams.get("date"), now);
    const slots = await listSlots(db, m[1], date, now);
    // Лениво: просроченные предложения освобождают время для следующего в листе.
    if ((await afterFreed(db, env, ctx, m[1], date, now)).length) return json({ date, slots: await listSlots(db, m[1], date, now) }, 200, env);
    return json({ date, slots }, 200, env);
  }

  if (p.startsWith("/api/appointments")) {
    const patient = await identifyPatient(req, env);
    if (!patient) return json({ error: "unauthorized" }, 401, env);
    if (rateLimited(`book:${patient.key}`, 30)) return json({ error: "rate_limited" }, 429, env);

    if (p === "/api/appointments" && req.method === "POST") {
      const body = await readJson(req);
      if (!body) return json({ error: "bad_request" }, 400, env);
      const { appointment, replay } = await bookSlot(db, patient, Number(body.slotId), String(body.idempotencyKey ?? ""), now);
      // Пациент записался на удержанное для него время обычным способом — закрываем его предложение в листе.
      await db
        .prepare("UPDATE waitlist SET status = 'booked', appointment_id = ?, updated_at = ? WHERE patient_key = ? AND offered_slot_id = ? AND status = 'offered'")
        .bind(appointment!.id, now.toISOString(), patient.key, appointment!.slot_id)
        .run();
      return json({ appointment: { ...publicAppointment(appointment!), queue: await queueInfo(db, appointment!, now) }, replay }, replay ? 200 : 201, env);
    }
    if (p === "/api/appointments/my" && req.method === "GET") return json({ appointments: await myAppointments(db, patient.key, now) }, 200, env);
    m = /^\/api\/appointments\/([0-9a-f-]{36})\/cancel$/.exec(p);
    if (m && req.method === "POST") {
      const before = await getAppointment(db, m[1]);
      const r = await cancelByPatient(db, patient.key, m[1], now);
      if (before) await afterFreed(db, env, ctx, before.doctor_id, before.local_date, now);
      return json(r, 200, env);
    }
  }

  // ---------- Лист ожидания (пациент) ----------
  if (p.startsWith("/api/waitlist")) {
    const patient = await identifyPatient(req, env);
    if (!patient) return json({ error: "unauthorized" }, 401, env);
    if (rateLimited(`wait:${patient.key}`, 30)) return json({ error: "rate_limited" }, 429, env);
    if (p === "/api/waitlist" && req.method === "POST") {
      const body = await readJson(req);
      return json({ entry: await joinWaitlist(db, patient, body?.doctorId, body?.date, now) }, 201, env);
    }
    if (p === "/api/waitlist/my" && req.method === "GET") return json({ entries: await myWaitlist(db, patient.key, now) }, 200, env);
    m = /^\/api\/waitlist\/([0-9a-f-]{36})\/accept$/.exec(p);
    if (m && req.method === "POST") {
      const body = await readJson(req);
      const { appointment, replay } = await acceptOffer(db, patient, m[1], String(body?.idempotencyKey ?? ""), now);
      return json({ appointment: { ...publicAppointment(appointment!), queue: await queueInfo(db, appointment!, now) }, replay }, replay ? 200 : 201, env);
    }
    m = /^\/api\/waitlist\/([0-9a-f-]{36})\/leave$/.exec(p);
    if (m && req.method === "POST") {
      const w = await leaveWaitlist(db, patient.key, m[1], now);
      await afterFreed(db, env, ctx, w.doctorId, w.date, now);
      return json({ ok: true }, 200, env);
    }
  }

  // ---------- Кабинет клиники ----------
  if (p.startsWith("/api/staff/")) {
    const staff = await authStaff(db, req.headers.get("Authorization"));
    if (!staff) return json({ error: "unauthorized" }, 401, env);
    if (rateLimited(`staff:${staff.id}`, 120)) return json({ error: "rate_limited" }, 429, env);

    if (p === "/api/staff/me" && req.method === "GET") {
      const clinics = (await listClinics(db)).filter((c) => c.id === staff.clinic_id);
      return json({ staff, clinic: clinics[0] ?? null }, 200, env);
    }
    if (p === "/api/staff/check-in" && req.method === "POST") {
      const body = await readJson(req);
      const a = await checkInByCode(db, staff, body?.code, now);
      return json({ appointment: { id: a?.id, ticket: a?.ticket, status: a?.status, patient_label: a?.patient_label, doctor_name: a?.doctor_name, starts_at: a?.starts_at } }, 200, env);
    }
    if (p === "/api/staff/schedule" && req.method === "GET") {
      const docId = url.searchParams.get("doctorId") ?? "";
      const d = url.searchParams.get("date");
      // Обработать лист ожидания только для врача своей клиники (чужие данные не трогаем).
      const doc = /^[A-Za-z0-9_-]{1,64}$/.test(docId) ? await getDoctor(db, docId) : null;
      if (doc && doc.clinic_id === staff.clinic_id) await afterFreed(db, env, ctx, docId, d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : localDate(now), now);
      return json(await daySchedule(db, staff, url.searchParams.get("doctorId") ?? "", url.searchParams.get("date"), now), 200, env);
    }
    m = /^\/api\/staff\/appointments\/([0-9a-f-]{36})\/action$/.exec(p);
    if (m && req.method === "POST") {
      const body = await readJson(req);
      const action = body?.action as Action;
      if (!ACTIONS.includes(action)) return json({ error: "unknown_action" }, 400, env);
      const a = await applyAction(db, staff, m[1], action, body?.reason, now);
      if (a && (action === "cancel" || action === "no_show")) await afterFreed(db, env, ctx, a.doctor_id, a.local_date, now);
      return json({ appointment: a }, 200, env);
    }
    if (p === "/api/staff/delay" && req.method === "POST") {
      const body = await readJson(req);
      return json(await setDelay(db, staff, String(body?.doctorId ?? ""), body?.delayMin, now), 200, env);
    }
    if (p === "/api/staff/walk-in" && req.method === "POST") {
      const body = await readJson(req);
      return json({ appointment: await walkInBooking(db, staff, body?.slotId, body?.label, now) }, 201, env);
    }
    if (p === "/api/staff/audit" && req.method === "GET") return json({ entries: await auditLog(db, staff) }, 200, env);
  }

  if (p === "/tg/webhook" && req.method === "POST") return handleBotWebhook(req, env);
  if (p.startsWith("/api/")) return json({ error: "not_found" }, 404, env);
  if (env.ASSETS) return env.ASSETS.fetch(req);
  return new Response("Not found", { status: 404 });
}

export default {
  /** Cron (раз в минуту): просроченные предложения передаются следующему даже без активности в приложении. */
  async scheduled(_event: unknown, env: Env, ctx?: Ctx): Promise<void> {
    if (!env.DB || env.PATIENT_DATA_HOST_APPROVED !== "true") return;
    const offers = await reconcileAll(env.DB, new Date());
    const p = notifyOffers(env, offers);
    if (ctx) ctx.waitUntil(p);
    else await p;
  },
  async fetch(req: Request, env: Env, ctx?: Ctx): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) return json(null, 204, env);
    try {
      return await route(req, env, url, ctx);
    } catch (e) {
      if (e instanceof BookingError) return json({ error: e.code, ...e.extra }, e.status, env);
      console.error("unhandled", (e as Error).message);
      return json({ error: "server_error" }, 500, env);
    }
  },
};
