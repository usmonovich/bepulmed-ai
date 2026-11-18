import { describe, it, expect, vi } from "vitest";
import { triage } from "../src/triage";
import { retrieve, KB, normalize } from "../src/kb";
import { signInitData, verifyInitData } from "../src/telegram";
import { askGemini, buildSystemPrompt, citedSources, offlineAnswer } from "../src/gemini";
import { buildOverpassQuery, mapOsm, parseFacilityQuery, type OsmElement } from "../src/overpass";
import worker, { handleChat, rateLimited, validateChatBody, type Env } from "../src/index";

describe("triage — экстренные состояния", () => {
  const positive = [
    "У меня сильная боль в груди",
    "болит за грудиной и отдаёт в руку",
    "не могу дышать",
    "мама потеряла сознание",
    "кажется у отца инсульт, лицо перекосило",
    "ребёнок не дышит",
    "Ko‘kragim og‘riyapti",
    "Ko‘kragim qattiq og‘riyapti",
    "сильно болит грудь",
    "грудь давит уже час",
    "yuragim juda og‘riyapti",
    "nafas ololmayapman",
    "u hushidan ketdi",
    "qon ketyapti to‘xtamayapti",
    "не хочу жить",
  ];
  for (const p of positive) it(`срабатывает: ${p}`, () => expect(triage(p).emergency).toBe(true));

  const negative = [
    "Могу ли я бесплатно пройти ЭКГ?",
    "Где ближайшая аптека?",
    "Bepul dori qanday olinadi?",
    "Как прикрепиться к поликлинике",
    "у грудного ребёнка болит живот, к какому врачу?",
    "",
  ];
  for (const n of negative) it(`не срабатывает: "${n}"`, () => expect(triage(n).emergency).toBe(false));

  it("отмечает self-harm отдельно", () => {
    expect(triage("не хочу жить").selfHarm).toBe(true);
    expect(triage("боль в груди").selfHarm).toBe(false);
  });
});

describe("kb — поиск источников", () => {
  it("ЭКГ → гарантированный пакет ПМСП", () => {
    const ids = retrieve("Могу ли я бесплатно пройти ЭКГ и куда обратиться?").map((e) => e.id);
    expect(ids[0]).toBe("km-382");
    expect(retrieve("EKG ni bepul o‘tsam bo‘ladimi?")[0].id).toBe("km-382");
  });
  it("лекарства по-узбекски → реимбурсация", () => {
    const ids = retrieve("Bepul dori dorixonadan qanday olaman?").map((e) => e.id);
    expect(ids).toContain("km-619");
  });
  it("бисопролол → перечень 69", () => {
    expect(retrieve("бисопролол бесплатно?").map((e) => e.id)).toContain("moh-69");
  });
  it("нерелевантный запрос → пусто", () => {
    expect(retrieve("какая погода в Самарканде")).toEqual([]);
    expect(retrieve("   ")).toEqual([]);
  });
  it("лимит количества", () => expect(retrieve("бесплатно лекарство аптека рецепт поликлиника экг", 2).length).toBe(2));
  it("нормализация апострофов", () => expect(normalize("Ko‘krak O`g'ri")).toBe("ko'krak o'g'ri"));
  it("у всех записей есть оба языка и https-ссылка", () => {
    for (const e of KB) {
      expect(e.text.ru && e.text.uz && e.title.ru && e.title.uz).toBeTruthy();
      expect(e.url.startsWith("https://")).toBe(true);
      expect(/^\d{4}-\d{2}-\d{2}$/.test(e.checked)).toBe(true);
    }
  });
  it("id уникальны", () => expect(new Set(KB.map((e) => e.id)).size).toBe(KB.length));
});

describe("telegram initData", () => {
  const token = "123456:TEST_TOKEN";
  const now = 1_800_000_000;
  const fields = { auth_date: String(now - 60), query_id: "AAH", user: JSON.stringify({ id: 42, first_name: "Ali" }) };

  it("валидная подпись", async () => {
    const init = await signInitData(fields, token);
    const r = await verifyInitData(init, token, 86400, now);
    expect(r).toEqual({ ok: true, userId: 42, firstName: "Ali" });
  });
  it("чужой токен", async () => {
    const init = await signInitData(fields, token);
    expect((await verifyInitData(init, "999:OTHER", 86400, now)).ok).toBe(false);
  });
  it("подмена данных", async () => {
    const init = (await signInitData(fields, token)).replace("Ali", "Bob");
    expect((await verifyInitData(init, token, 86400, now)).reason).toBe("bad_hash");
  });
  it("просрочено", async () => {
    const init = await signInitData({ ...fields, auth_date: String(now - 100000) }, token);
    expect((await verifyInitData(init, token, 86400, now)).reason).toBe("expired");
  });
  it("пусто / без hash", async () => {
    expect((await verifyInitData("", token)).ok).toBe(false);
    expect((await verifyInitData("auth_date=1", token)).reason).toBe("no_hash");
  });
});

describe("gemini", () => {
  const src = retrieve("бесплатно ЭКГ поликлиника");

  it("системный промпт содержит источники и правила", () => {
    const p = buildSystemPrompt("ru", src);
    expect(p).toContain("[km-382]");
    expect(p).toContain("ТОЛЬКО");
    expect(buildSystemPrompt("uz", src)).toContain("узбекском");
  });

  it("корректный запрос и разбор ответа", async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain("models/m1:generateContent");
      const body = JSON.parse(init.body as string);
      expect(body.contents.at(-1)).toEqual({ role: "user", parts: [{ text: "q" }] });
      expect(body.contents[0].role).toBe("user");
      expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Ответ [km-382]" }] } }] }));
    });
    const r = await askGemini("sys", [{ role: "user", text: "q" }], { apiKey: "k", model: "m1", fetchImpl: fetchImpl as never });
    expect(r).toBe("Ответ [km-382]");
  });

  it("при 404 основной модели использует запасную", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("m1") ? new Response("no", { status: 404 }) : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })),
    );
    const r = await askGemini("s", [{ role: "user", text: "q" }], { apiKey: "k", model: "m1", fallbackModel: "m2", fetchImpl: fetchImpl as never });
    expect(r).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("400 не ретраится", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 400 }));
    await expect(askGemini("s", [{ role: "user", text: "q" }], { apiKey: "k", model: "m1", fallbackModel: "m2", fetchImpl: fetchImpl as never })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("citedSources и offlineAnswer", () => {
    expect(citedSources("текст [km-382]", src).map((s) => s.id)).toEqual(["km-382"]);
    expect(citedSources("без ссылок", src).length).toBe(src.length);
    expect(offlineAnswer("ru", [])).toContain("подтверждённых данных нет");
    expect(offlineAnswer("uz", src)).toContain("[km-382]");
  });
});

describe("chat handler", () => {
  it("валидация тела", () => {
    expect(validateChatBody(null)).toBeNull();
    expect(validateChatBody({ messages: [] })).toBeNull();
    expect(validateChatBody({ messages: [{ role: "system", text: "x" }] })).toBeNull();
    expect(validateChatBody({ messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "a" }] })).toBeNull();
    const b = validateChatBody({ messages: [{ role: "assistant", text: "привет" }, { role: "user", text: "x".repeat(5000) }], lang: "uz" });
    expect(b?.messages.length).toBe(1);
    expect(b?.messages[0].text.length).toBe(1000);
    expect(b?.lang).toBe("uz");
    expect(validateChatBody({ messages: [{ role: "user", text: "a" }], lang: "en" })?.lang).toBe("ru");
  });

  it("экстренный запрос не уходит в ИИ", async () => {
    const fetchImpl = vi.fn();
    const r = await handleChat({ lang: "ru", messages: [{ role: "user", text: "сильная боль в груди" }] }, { GEMINI_API_KEY: "k" }, fetchImpl as never);
    expect(r.emergency).toBe(true);
    expect(r.answer).toContain("103");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("по умолчанию медицинский текст не передаётся внешнему Gemini даже при наличии ключа", async () => {
    const fetchImpl = vi.fn();
    const r = await handleChat(
      { lang: "ru", messages: [{ role: "user", text: "Можно ли бесплатно сделать ЭКГ?" }] },
      { GEMINI_API_KEY: "configured-but-disabled" },
      fetchImpl as never,
    );
    expect(r.mode).toBe("offline");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("без ключа — офлайн-ответ из базы", async () => {
    const r = await handleChat({ lang: "ru", messages: [{ role: "user", text: "Можно ли бесплатно сделать ЭКГ?" }] }, {});
    expect(r.mode).toBe("offline");
    expect(r.sources.map((s) => s.id)).toContain("km-382");
  });

  it("сбой Gemini → офлайн-ответ, без исключения", async () => {
    const fetchImpl = vi.fn(async () => new Response("err", { status: 500 }));
    const r = await handleChat({ lang: "ru", messages: [{ role: "user", text: "бесплатные лекарства в аптеке" }] }, { GEMINI_API_KEY: "k" }, fetchImpl as never);
    expect(r.mode).toBe("offline");
    expect(r.answer.length).toBeGreaterThan(20);
  });

  it("уточняющий вопрос использует контекст прошлых сообщений", async () => {
    const r = await handleChat(
      { lang: "ru", messages: [{ role: "user", text: "бесплатная ЭКГ" }, { role: "assistant", text: "..." }, { role: "user", text: "а куда идти?" }] },
      {},
    );
    expect(r.sources.map((s) => s.id)).toContain("km-382");
  });

  it("rate limit", () => {
    const k = "test-" + Math.random();
    for (let i = 0; i < 20; i++) expect(rateLimited(k, 20, 60000, 1000)).toBe(false);
    expect(rateLimited(k, 20, 60000, 1000)).toBe(true);
    expect(rateLimited(k, 20, 60000, 70000)).toBe(false);
  });
});

describe("HTTP-маршруты", () => {
  const call = (path: string, init?: RequestInit, env = {}) => worker.fetch(new Request("https://x.dev" + path, init), env);

  it("health", async () => {
    const r = await call("/api/health");
    expect(r.status).toBe(200);
    const data = (await r.json()) as { ok: boolean; ai: boolean; voice: boolean; booking: boolean; patientDataHostApproved: boolean; serverHealthChat: boolean };
    expect(data.ok).toBe(true);
    expect(data.ai).toBe(false);
    expect(data.voice).toBe(false);
    expect(data.booking).toBe(false);
    expect(data.patientDataHostApproved).toBe(false);
    expect(data.serverHealthChat).toBe(false);
  });
  it("запись заблокирована без подтверждения локального хостинга данных", async () => {
    const r = await call("/api/clinics", undefined, { DB: {} });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe("patient_data_host_not_approved");
  });
  it("внешний STT заблокирован по умолчанию", async () => {
    const r = await call("/api/voice/stt", { method: "POST" }, { VOICELAB_API_KEY: "configured-but-disabled" });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe("external_voice_transfer_disabled");
  });

  it("chat: серверный медицинский чат выключен по умолчанию", async () => {
    const r = await call("/api/chat", { method: "POST", body: "not json" });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe("server_health_chat_disabled_use_on_device");
  });
  it("chat: неверное тело → 400 при явном включении серверного режима", async () => {
    const r = await call("/api/chat", { method: "POST", body: "not json" }, { SERVER_HEALTH_CHAT_ENABLED: "true" });
    expect(r.status).toBe(400);
  });
  it("chat: REQUIRE_TELEGRAM без initData → 401", async () => {
    const r = await call("/api/chat", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", text: "a" }] }) }, { REQUIRE_TELEGRAM: "true", SERVER_HEALTH_CHAT_ENABLED: "true" });
    expect(r.status).toBe(401);
  });
  it("chat: с валидным initData → 200", async () => {
    const token = "1:T";
    const init = await signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 7 }) }, token);
    const r = await call(
      "/api/chat",
      { method: "POST", headers: { "X-Telegram-Init-Data": init }, body: JSON.stringify({ messages: [{ role: "user", text: "бесплатная ЭКГ" }] }) },
      { BOT_TOKEN: token, REQUIRE_TELEGRAM: "true", SERVER_HEALTH_CHAT_ENABLED: "true" },
    );
    expect(r.status).toBe(200);
    expect(((await r.json()) as { sources: unknown[] }).sources.length).toBeGreaterThan(0);
  });
  it("facilities: Overpass недоступен → 503 с понятной ошибкой", async () => {
    const r = await call("/api/facilities?lat=41.31&lon=69.24", undefined, { OVERPASS_URL: "http://127.0.0.1:9/none" });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe("upstream_unavailable");
  });
  it("facilities: неверные координаты → 400", async () => {
    expect((await call("/api/facilities?lat=abc&lon=1")).status).toBe(400);
    expect((await call("/api/facilities?lat=100&lon=1")).status).toBe(400);
  });
  it("неизвестный API → 404, OPTIONS → 204", async () => {
    expect((await call("/api/nope")).status).toBe(404);
    expect((await call("/api/chat", { method: "OPTIONS" })).status).toBe(204);
  });
  it("webhook без настройки → 503", async () => {
    expect((await call("/tg/webhook", { method: "POST", body: "{}" })).status).toBe(503);
  });
});

describe("overpass", () => {
  it("парсинг запроса и ограничение радиуса", () => {
    const q = parseFacilityQuery(new URL("https://x/?lat=41.3&lon=69.24&radius=999999&kinds=pharmacy,evil"));
    expect(q).toEqual({ lat: 41.3, lon: 69.24, radius: 10000, kinds: ["pharmacy"] });
    expect(parseFacilityQuery(new URL("https://x/?lat=41&lon=69&kinds=evil"))).toEqual({ error: "invalid_kinds" });
    expect(parseFacilityQuery(new URL("https://x/?lon=69"))).toEqual({ error: "invalid_coordinates" });
  });
  it("строит запрос Overpass", () => {
    const s = buildOverpassQuery({ lat: 41.3, lon: 69.24, radius: 2000, kinds: ["hospital", "pharmacy"] });
    expect(s).toContain('nwr["amenity"="hospital"](around:2000,41.300000,69.240000);');
    expect(s).toContain('"pharmacy"');
    expect(s).not.toContain("clinic");
  });
  it("маппинг OSM: язык, адрес, без названия и дубли отбрасываются", () => {
    const els: OsmElement[] = [
      { type: "node", id: 1, lat: 41, lon: 69, tags: { amenity: "pharmacy", name: "Dorixona", "name:ru": "Аптека", "addr:street": "Навои", "addr:housenumber": "5", phone: "+998 71 000" } },
      { type: "way", id: 2, center: { lat: 41.1, lon: 69.1 }, tags: { amenity: "hospital", name: "Shifoxona" } },
      { type: "node", id: 3, lat: 41, lon: 69, tags: { amenity: "clinic" } },
      { type: "node", id: 1, lat: 41, lon: 69, tags: { amenity: "pharmacy", name: "dup" } },
      { type: "node", id: 4, tags: { amenity: "clinic", name: "nocoords" } },
      { type: "node", id: 5, lat: 41.2, lon: 69.2, tags: { healthcare: "hospital", name: "Hospital tagged by healthcare" } },
      { type: "node", id: 6, lat: 41.3, lon: 69.3, tags: { healthcare: "polyclinic", name: "Polyclinic tagged by healthcare" } },
    ];
    const ru = mapOsm(els, "ru");
    expect(ru.length).toBe(4);
    expect(ru[0]).toMatchObject({ name: "Аптека", kind: "pharmacy", address: "Навои, 5", verified: false });
    expect(ru[2]).toMatchObject({ kind: "hospital", name: "Hospital tagged by healthcare" });
    expect(ru[3]).toMatchObject({ kind: "clinic", name: "Polyclinic tagged by healthcare" });
    expect(ru[1]).toMatchObject({ kind: "hospital", lat: 41.1 });
    expect(mapOsm(els, "uz")[0].name).toBe("Dorixona");
  });
});

describe("защита данных по умолчанию (2.6+)", () => {
  const call = (path: string, init?: RequestInit, env: Record<string, unknown> = {}) => worker.fetch(new Request("https://x.dev" + path, init), env as never);
  it("серверный медицинский чат закрыт, пока явно не включён", async () => {
    const r = await call("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: "ru", messages: [{ role: "user", text: "болит голова" }] }) });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe("server_health_chat_disabled_use_on_device");
  });
  it("запись/талоны закрыты без подтверждённого хостинга пациентских данных", async () => {
    const r = await call("/api/clinics", undefined, { DB: {} });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe("patient_data_host_not_approved");
  });
  it("внешний голос закрыт без разрешения, даже при наличии ключа", async () => {
    const r = await call("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, { VOICELAB_API_KEY: "k" });
    expect(r.status).toBe(503);
  });
  it("health честно сообщает режим", async () => {
    const h = (await (await call("/api/health", undefined, { GEMINI_API_KEY: "g", VOICELAB_API_KEY: "k", DB: {} })).json()) as Record<string, unknown>;
    expect(h).toMatchObject({ ai: false, llm: "offline-kb", voice: false, booking: false, patientDataHostApproved: false });
  });
});

describe("заголовки безопасности API (2.8)", () => {
  it("no-referrer, HSTS, запрет встраивания и no-store", async () => {
    const r = await worker.fetch(new Request("https://x/api/health"), { DB: undefined } as unknown as Env, {} as ExecutionContext);
    expect(r.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(r.headers.get("Strict-Transport-Security")).toMatch(/max-age=31536000/);
    expect(r.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
});
