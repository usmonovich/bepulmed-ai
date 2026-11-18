// Клиент VoiceLab (https://api.voicelab.uz). Формат запросов сверен с исходниками
// официального клиента voicelab-uz/mcp: Bearer-авторизация, Idempotency-Key в заголовке,
// STT асинхронный (задача → опрос /v1/stt/transcriptions/{id}), TTS возвращает WAV.

export interface VoiceLabConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class VoiceLabError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

const base = (c: VoiceLabConfig) => (c.baseUrl ?? "https://api.voicelab.uz").replace(/\/$/, "");

async function vlFetch(c: VoiceLabConfig, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const f = c.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(base(c) + path, {
      ...init,
      headers: { Authorization: `Bearer ${c.apiKey}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(init.timeoutMs ?? 20000),
    });
  } catch {
    throw new VoiceLabError("voicelab_unreachable", 502);
  }
  if (!res.ok) {
    const code = res.status === 401 || res.status === 403 ? "voicelab_auth" : res.status === 402 ? "voicelab_no_credits" : res.status === 429 ? "voicelab_rate_limited" : "voicelab_error";
    throw new VoiceLabError(code, res.status);
  }
  return res;
}

interface Transcription {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  transcript?: string;
  error?: { code: string; message: string };
}

export const STT_LANGS = ["uz", "ru", "auto"] as const;
export type SttLang = (typeof STT_LANGS)[number];

/** Отправляет аудио и ждёт результат (короткие голосовые сообщения). */
export async function transcribe(c: VoiceLabConfig, audio: Blob, filename: string, language: SttLang, idemKey: string, maxWaitMs = 25000): Promise<string> {
  const form = new FormData();
  form.append("audio", new File([audio], filename, { type: audio.type || "application/octet-stream" }));
  form.append("language", language);
  form.append("include_speakers", "false");
  const res = await vlFetch(c, "/v1/stt", { method: "POST", body: form, headers: { "Idempotency-Key": idemKey }, timeoutMs: 30000 });
  let job = (await res.json()) as Transcription;
  const sleep = c.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const started = Date.now();
  let delay = 700;
  while (job.status === "queued" || job.status === "processing") {
    if (Date.now() - started > maxWaitMs) throw new VoiceLabError("voicelab_timeout", 504);
    await sleep(delay);
    delay = Math.min(2000, Math.round(delay * 1.4));
    job = (await (await vlFetch(c, `/v1/stt/transcriptions/${encodeURIComponent(job.id)}`)).json()) as Transcription;
  }
  if (job.status !== "completed") throw new VoiceLabError("voicelab_stt_failed", 502);
  return (job.transcript ?? "").trim();
}

const voiceCache = new Map<string, string>();

export async function pickVoice(c: VoiceLabConfig, language: "uz" | "ru", configured?: string): Promise<string> {
  if (configured) return configured;
  const hit = voiceCache.get(language);
  if (hit) return hit;
  const r = (await (await vlFetch(c, `/v1/voices?language=${language}`)).json()) as { data?: { id: string; kind?: string }[] };
  const voice = r.data?.find((v) => v.kind !== "custom") ?? r.data?.[0];
  if (!voice) throw new VoiceLabError("voicelab_no_voice", 502);
  voiceCache.set(language, voice.id);
  return voice.id;
}

/** Возвращает WAV. Неизвестные поля API отклоняет, поэтому отправляем только text, language, voice_id. */
export async function synthesize(c: VoiceLabConfig, text: string, language: "uz" | "ru", voiceId: string, idemKey: string): Promise<ArrayBuffer> {
  const res = await vlFetch(c, "/v1/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idemKey },
    body: JSON.stringify({ text, language, voice_id: voiceId }),
    timeoutMs: 30000,
  });
  return res.arrayBuffer();
}

/** OpenAI-совместимый чат VoiceLab. */
export async function voicelabChat(c: VoiceLabConfig, model: string, system: string, history: { role: "user" | "assistant"; text: string }[]): Promise<string> {
  const res = await vlFetch(c, "/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, ...history.map((h) => ({ role: h.role, content: h.text }))],
      temperature: 0.2,
      max_tokens: 700,
    }),
    timeoutMs: 25000,
  });
  const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new VoiceLabError("voicelab_empty", 502);
  return text;
}
