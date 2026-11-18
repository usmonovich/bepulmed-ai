// Проверка Telegram WebApp initData по официальному алгоритму:
// secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
// hash = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))

const enc = new TextEncoder();

async function hmac(key: BufferSource, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export interface InitDataResult {
  ok: boolean;
  userId?: number;
  firstName?: string;
  lastName?: string;
  reason?: string;
}

export async function signInitData(fields: Record<string, string>, botToken: string): Promise<string> {
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const hash = toHex(await hmac(secret, dcs));
  const p = new URLSearchParams(fields);
  p.set("hash", hash);
  return p.toString();
}

export async function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 86400,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<InitDataResult> {
  if (!initData) return { ok: false, reason: "empty" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "no_hash" };
  params.delete("hash");
  const dcs = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const expected = toHex(await hmac(secret, dcs));
  if (!timingSafeEqual(expected, hash.toLowerCase())) return { ok: false, reason: "bad_hash" };
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || nowSec - authDate > maxAgeSec) return { ok: false, reason: "expired" };
  let userId: number | undefined;
  let firstName: string | undefined;
  let lastName: string | undefined;
  try {
    const u = JSON.parse(params.get("user") ?? "null");
    if (u && typeof u.id === "number") userId = u.id;
    if (u && typeof u.first_name === "string") firstName = u.first_name.slice(0, 40);
    if (u && typeof u.last_name === "string") lastName = u.last_name.slice(0, 40);
  } catch {
    /* user необязателен */
  }
  return { ok: true, userId, ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}) };
}
