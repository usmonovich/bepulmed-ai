// DMED / Цифровая платформа здравоохранения (DHP) Узбекистана — подключение пациента.
//
// Основа — официальное руководство Uzinfocom/Минздрава (FHIR, раздел «API access»):
//   FHIR: playground.dhp.uz/fhir (тест), fhir.dhp.uz (боевой);
//   вход: OAuth 2.0 через SSO sso.dhp.uz, для приложения без своего сервера — authorization code + PKCE.
// Приложение должно быть зарегистрировано на SSO (client_id). Пока client_id не задан
// (VITE_DMED_CLIENT_ID при сборке), модуль выключен и ничего никуда не отправляет.
//
// Защита данных (ст. 25 ЗРУ-547 — данные о здоровье особые):
//   • данные DMED читаются только с явного согласия пользователя на этом экране;
//   • токен и полученные данные живут только в памяти телефона — не пишутся в хранилище
//     и никогда не отправляются на сервер BepulMed или во внешний ИИ;
//   • ПИНФЛ приложение не спрашивает: личность подтверждает сам DMED (SSO).
//   • только чтение (scope по умолчанию), никаких изменений в DMED.

import { FREE_MEDS, type FreeMed } from "../data/freeMeds";
import { search } from "./search";

export interface DmedConfig {
  env: "playground" | "production";
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  fhirBase: string;
  scope: string;
  redirectUri: string;
}

const env = (k: string): string => ((import.meta as { env?: Record<string, string | undefined> }).env?.[k] ?? "").trim();
export const NATIVE_REDIRECT = "uz.bepulmed.app:/oauth2redirect";
const ALLOWED_HOST = /(^|\.)dhp\.uz$|(^|\.)medcore\.uz$/;

function nativeShell(): boolean {
  return typeof navigator !== "undefined" && /BepulMed(Android|IOS)\//.test(navigator.userAgent);
}

/** Настройки DMED или null, если приложение ещё не зарегистрировано (нет client_id). */
export function dmedConfig(over: Partial<Record<string, string>> = {}): DmedConfig | null {
  const g = (k: string) => (over[k] ?? env(k)).trim();
  const clientId = g("VITE_DMED_CLIENT_ID");
  if (!clientId) return null;
  const production = g("VITE_DMED_ENV") === "production";
  const sso = (g("VITE_DMED_SSO") || "https://sso.dhp.uz").replace(/\/+$/, "");
  const cfg: DmedConfig = {
    env: production ? "production" : "playground",
    clientId,
    authorizeUrl: g("VITE_DMED_AUTHORIZE_URL") || `${sso}/oauth/authorize`,
    tokenUrl: g("VITE_DMED_TOKEN_URL") || `${sso}/oauth/token`,
    fhirBase: (g("VITE_DMED_FHIR") || (production ? "https://fhir.dhp.uz" : "https://playground.dhp.uz/fhir")).replace(/\/+$/, ""),
    scope: g("VITE_DMED_SCOPE") || "openid",
    redirectUri:
      g("VITE_DMED_REDIRECT") ||
      (nativeShell() ? NATIVE_REDIRECT : typeof location !== "undefined" ? `${location.origin}${(env("BASE_URL") || "/").replace(/\/?$/, "/")}` : ""),
  };
  // Секреты и пациентские данные — только на официальные хосты DHP/DMED по https.
  for (const u of [cfg.authorizeUrl, cfg.tokenUrl, cfg.fhirBase]) {
    const p = new URL(u);
    if (p.protocol !== "https:" || !ALLOWED_HOST.test(p.hostname)) throw new Error(`dmed_host_not_allowed:${p.hostname}`);
  }
  return cfg;
}

// ---------- PKCE (RFC 7636) ----------

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 без crypto.subtle (в iOS WKWebView со своей схемой его может не быть). */
export function sha256(data: Uint8Array): Uint8Array {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = data.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(data);
  m[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(total - 4, bits >>> 0);
  const w = new Uint32Array(64);
  const r = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  H.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

function randomString(n: number): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => abc[b % abc.length]).join("");
}

export function pkceChallenge(verifier: string): string {
  return b64url(sha256(new TextEncoder().encode(verifier)));
}

// ---------- Вход ----------

const PENDING = "bm_dmed_pending"; // state + verifier на время входа (10 минут), без токенов и данных
const PENDING_TTL = 10 * 60 * 1000;

interface Pending {
  state: string;
  verifier: string;
  at: number;
}

export function buildAuthorizeUrl(cfg: DmedConfig, now = Date.now()): string {
  const p: Pending = { state: randomString(32), verifier: randomString(64), at: now };
  try {
    localStorage.setItem(PENDING, JSON.stringify(p));
  } catch {
    /* без хранилища вход не завершится — сообщим при возврате */
  }
  const q = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: cfg.scope,
    state: p.state,
    code_challenge: pkceChallenge(p.verifier),
    code_challenge_method: "S256",
  });
  return `${cfg.authorizeUrl}?${q}`;
}

export type CallbackResult = { ok: true; code: string; verifier: string } | { ok: false; error: string };

/** Разбор возврата из SSO: проверка state (защита от подмены), срока, ошибки. */
export function parseCallback(url: string, now = Date.now()): CallbackResult | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const p = u.searchParams;
  if (!p.has("code") && !p.has("error")) return null;
  let pend: Pending | null = null;
  try {
    pend = JSON.parse(localStorage.getItem(PENDING) ?? "null") as Pending | null;
    localStorage.removeItem(PENDING);
  } catch {
    pend = null;
  }
  if (p.get("error")) return { ok: false, error: p.get("error") === "access_denied" ? "denied" : "sso_error" };
  if (!pend || now - pend.at > PENDING_TTL) return { ok: false, error: "expired" };
  if (p.get("state") !== pend.state) return { ok: false, error: "state_mismatch" };
  return { ok: true, code: p.get("code")!, verifier: pend.verifier };
}

// ---------- HTTP: в приложениях — через нативный мост (без CORS), в вебе — fetch ----------

interface HttpResp {
  status: number;
  body: string;
}
type NativeHttp = { http?(id: string, method: string, url: string, headers: string, body: string): void };
const waiting = new Map<string, (r: HttpResp) => void>();
let seq = 0;

/** Ответ нативного запроса (Android/iOS вызывают через событие type:"http"). */
export function onNativeHttp(e: { id?: string; status?: number; body?: string }): void {
  const cb = e.id ? waiting.get(e.id) : undefined;
  if (!cb) return;
  waiting.delete(e.id!);
  cb({ status: e.status ?? 0, body: e.body ?? "" });
}

export async function dmedHttp(method: "GET" | "POST", url: string, headers: Record<string, string>, body = ""): Promise<HttpResp> {
  const host = new URL(url).hostname;
  if (!ALLOWED_HOST.test(host)) throw new Error("dmed_host_not_allowed");
  const nat = (typeof window !== "undefined" ? (window as unknown as { BepulMedNative?: NativeHttp }).BepulMedNative : undefined) ?? undefined;
  if (nat?.http) {
    const id = `h${++seq}`;
    return new Promise<HttpResp>((resolve) => {
      const t = setTimeout(() => {
        waiting.delete(id);
        resolve({ status: 0, body: "" });
      }, 20000);
      waiting.set(id, (r) => {
        clearTimeout(t);
        resolve(r);
      });
      nat.http!(id, method, url, JSON.stringify(headers), body);
    });
  }
  try {
    const r = await fetch(url, { method, headers, body: method === "POST" ? body : undefined, credentials: "omit", referrerPolicy: "no-referrer" });
    return { status: r.status, body: await r.text() };
  } catch {
    return { status: 0, body: "" };
  }
}

export interface Token {
  access: string;
  expiresAt: number;
  patient?: string; // если SSO сообщает id пациента (как SMART)
}

export async function exchangeCode(cfg: DmedConfig, code: string, verifier: string, now = Date.now()): Promise<Token> {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, client_id: cfg.clientId, code_verifier: verifier }).toString();
  const r = await dmedHttp("POST", cfg.tokenUrl, { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body);
  if (r.status === 0) throw new Error("network");
  const j = JSON.parse(r.body || "{}") as { access_token?: string; expires_in?: number; patient?: string; error?: string };
  if (r.status !== 200 || !j.access_token) throw new Error(j.error === "invalid_grant" ? "expired" : "token_failed");
  return { access: j.access_token, expiresAt: now + Math.max(60, j.expires_in ?? 3600) * 1000, patient: j.patient };
}

// ---------- FHIR (R5, допускаем и R4) ----------

type J = Record<string, unknown>;
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function cc(v: unknown): string {
  const c = (v ?? {}) as J;
  if (str(c.text)) return str(c.text);
  const d = arr(c.coding).find((x) => str(x.display));
  return d ? str(d.display) : str(arr(c.coding)[0]?.code);
}

/** CodeableReference (R5) или CodeableConcept/Reference (R4) → текст. */
function codeOrRef(v: unknown): string {
  const o = (v ?? {}) as J;
  if (o.concept) return cc(o.concept);
  if (o.reference && typeof o.reference === "object") return str((o.reference as J).display);
  if (str(o.display)) return str(o.display);
  return cc(o);
}

export interface DmedPatient {
  id: string;
  name: string;
  birthDate?: string;
  gp?: string; // ссылка на прикреплённую поликлинику Organization/...
}

export function parsePatient(p: J): DmedPatient {
  const n = arr(p.name)[0] ?? {};
  const given = Array.isArray(n.given) ? (n.given as unknown[]).map(str) : [];
  const name = str(n.text) || [str(n.family), ...given].filter(Boolean).join(" ");
  const gp = arr(p.generalPractitioner).map((r) => str(r.reference)).find((r) => r.startsWith("Organization/")) || str((p.managingOrganization as J | undefined)?.reference);
  return { id: str(p.id), name: name || "—", birthDate: str(p.birthDate) || undefined, gp: gp || undefined };
}

export interface DmedPrescription {
  id: string;
  name: string;
  dosage: string;
  date: string;
  status: string;
  requester: string;
  free?: FreeMed;
}

/** Совпадение с перечнем бесплатных лекарств (реимбурсация) по МНН. */
export function matchFreeMed(name: string): FreeMed | undefined {
  if (!name) return undefined;
  // «Метформин 850 мг, таб.» → «Метформин»: убираем дозировку и всё после неё.
  const mnn = name.replace(/\s*\d[\d.,]*\s*(мг|mg|мкг|mcg|г|g|мл|ml|ме|ед|iu|%)(?=$|[\s,;)/]).*$/iu, "").trim() || name;
  const hits = search(FREE_MEDS, mnn, (m) => [{ text: m.ru, weight: 1 }, { text: m.uz, weight: 1 }, ...(m.brands ?? []).map((b) => ({ text: b, weight: 0.8 }))], { minCoverage: 0.99 });
  return hits[0]?.item;
}

export function parsePrescriptions(bundle: J): DmedPrescription[] {
  return arr(bundle.entry)
    .map((e) => (e.resource ?? {}) as J)
    .filter((r) => r.resourceType === "MedicationRequest")
    .map((r) => {
      const name = codeOrRef(r.medication) || cc(r.medicationCodeableConcept) || str((r.medicationReference as J | undefined)?.display);
      const dosage = arr(r.dosageInstruction).map((d) => str(d.text)).filter(Boolean).join("; ");
      return {
        id: str(r.id),
        name: name || "—",
        dosage,
        date: str(r.authoredOn).slice(0, 10),
        status: str(r.status),
        requester: str((r.requester as J | undefined)?.display),
        free: matchFreeMed(name),
      };
    })
    .filter((p) => p.status !== "entered-in-error")
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface DmedAppointment {
  id: string;
  start: string;
  status: string;
  service: string;
  who: string;
}

export function parseAppointments(bundle: J, now = Date.now()): DmedAppointment[] {
  return arr(bundle.entry)
    .map((e) => (e.resource ?? {}) as J)
    .filter((r) => r.resourceType === "Appointment" && str(r.start))
    .map((r) => ({
      id: str(r.id),
      start: str(r.start),
      status: str(r.status),
      service: arr(r.serviceType).map(codeOrRef).filter(Boolean).join(", ") || cc(r.appointmentType),
      who: arr(r.participant)
        .map((p) => str((p.actor as J | undefined)?.display))
        .filter(Boolean)
        .join(", "),
    }))
    .filter((a) => Date.parse(a.start) >= now - 3600e3 && !["cancelled", "entered-in-error", "noshow"].includes(a.status))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export interface DmedData {
  patient: DmedPatient;
  clinic?: { name: string; address: string; phone: string };
  prescriptions: DmedPrescription[];
  appointments: DmedAppointment[];
  fetchedAt: number;
}

async function fhirGet(cfg: DmedConfig, tok: Token, path: string): Promise<J> {
  const r = await dmedHttp("GET", `${cfg.fhirBase}/${path}`, { Authorization: `Bearer ${tok.access}`, Accept: "application/fhir+json" });
  if (r.status === 401 || r.status === 403) throw new Error("unauthorized");
  if (r.status === 0) throw new Error("network");
  if (r.status !== 200) throw new Error(`fhir_${r.status}`);
  return JSON.parse(r.body) as J;
}

/** Только чтение: пациент, прикреплённая поликлиника, электронные рецепты, предстоящие записи. */
export async function loadDmed(cfg: DmedConfig, tok: Token, now = Date.now()): Promise<DmedData> {
  if (tok.expiresAt <= now) throw new Error("unauthorized");
  let p: J;
  if (tok.patient) p = await fhirGet(cfg, tok, `Patient/${encodeURIComponent(tok.patient)}`);
  else {
    // Без id из SSO: ищем пациентов, доступных токену. Принимаем только однозначный результат.
    const b = await fhirGet(cfg, tok, "Patient?_count=2");
    const list = arr(b.entry).map((e) => (e.resource ?? {}) as J).filter((r) => r.resourceType === "Patient");
    if (list.length !== 1) throw new Error("patient_ambiguous");
    p = list[0];
  }
  const patient = parsePatient(p);
  const ref = encodeURIComponent(`Patient/${patient.id}`);
  const [meds, appts, org] = await Promise.all([
    fhirGet(cfg, tok, `MedicationRequest?subject=${ref}&_count=50`).catch(() => ({}) as J),
    fhirGet(cfg, tok, `Appointment?patient=${ref}&_count=20`).catch(() => ({}) as J),
    patient.gp ? fhirGet(cfg, tok, patient.gp).catch(() => null) : Promise.resolve(null),
  ]);
  const clinic = org
    ? {
        name: str(org.name) || "—",
        address: [...arr(org.address), ...arr(org.contact).map((c) => c.address as J).filter(Boolean)].map((a) => str(a.text) || [Array.isArray(a.line) ? (a.line as unknown[]).map(str).join(", ") : str(a.line), str(a.city)].filter(Boolean).join(", "))[0] ?? "",
        phone: arr(org.telecom ?? arr(org.contact).flatMap((c) => arr(c.telecom))).filter((t) => t.system === "phone").map((t) => str(t.value))[0] ?? "",
      }
    : undefined;
  return { patient, clinic, prescriptions: parsePrescriptions(meds), appointments: parseAppointments(appts, now), fetchedAt: now };
}

// ---------- Возврат из SSO в приложение ----------
// Android/iOS вызывают window.__bmAuth(url) после возврата по uz.bepulmed.app:/oauth2redirect.
// Сохраняем до появления экрана DMED (событие может прийти раньше отрисовки).
let pendingCallback: string | null = null;
const authListeners = new Set<(url: string) => void>();

export function onAuthCallback(fn: (url: string) => void): () => void {
  authListeners.add(fn);
  if (pendingCallback) {
    const u = pendingCallback;
    pendingCallback = null;
    fn(u);
  }
  return () => authListeners.delete(fn);
}

function deliver(url: string) {
  if (authListeners.size) authListeners.forEach((f) => f(url));
  else pendingCallback = url;
}

if (typeof window !== "undefined") {
  (window as unknown as { __bmAuth?: (u: string) => void }).__bmAuth = (u) => typeof u === "string" && deliver(u);
  // Веб-версия: SSO вернул на наш адрес с ?code=…&state=… — забираем и убираем код из адресной строки.
  try {
    const q = new URLSearchParams(location.search);
    if ((q.has("code") || q.has("error")) && q.has("state") && localStorage.getItem(PENDING)) {
      deliver(location.href);
      history.replaceState(null, "", location.pathname + location.hash);
    }
  } catch {
    /* нет location/хранилища */
  }
}

/** Открыть страницу входа DMED: в приложениях — системный браузер/ASWebAuthenticationSession, в вебе — переход. */
export function openLogin(url: string): void {
  const nat = (window as unknown as { BepulMedNative?: { openAuth?(u: string): void } }).BepulMedNative;
  if (nat?.openAuth) nat.openAuth(url);
  else location.assign(url);
}

// ---------- Сессия DMED на время работы приложения (только память) ----------
let session: Token | null = null;
export const setDmedSession = (t: Token | null) => {
  session = t;
};
export const dmedSession = (now = Date.now()): Token | null => (session && session.expiresAt > now ? session : null);

/** Публичная часть: врачи организации (PractitionerRole) — по сессии пациента, только чтение. */
export async function dmedDoctorsByName(cfg: DmedConfig, tok: Token, orgName: string): Promise<Record<string, unknown> | null> {
  const org = await fhirGet(cfg, tok, `Organization?name=${encodeURIComponent(orgName.slice(0, 80))}&_count=3`);
  const first = arr(org.entry).map((e) => (e.resource ?? {}) as J).find((r) => r.resourceType === "Organization");
  if (!first) return null;
  return fhirGet(cfg, tok, `PractitionerRole?organization=Organization/${encodeURIComponent(str(first.id))}&_include=PractitionerRole:practitioner&_count=100`);
}
