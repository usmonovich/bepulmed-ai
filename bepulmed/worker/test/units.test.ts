import { describe, expect, it, vi } from "vitest";
import { detectIntent } from "../src/intent";
import { pickVoice, synthesize, transcribe, voicelabChat, VoiceLabError } from "../src/voicelab";
import { buildDaySlots, estimateWait, ticketFor } from "../src/booking";
import { canDo } from "../src/staff";
import { isValidDate, localDate, localHHMM, localToUtc, weekdayOf } from "../src/time";
import { handleChat } from "../src/index";

describe("намерение записи", () => {
  it.each([
    ["Menga kardiolog kerak, можно бесплатно записаться?", "cardiology"],
    ["мне нужен терапевт", "therapy"],
    ["Хочу к семейному врачу", "therapy"],
    ["oilaviy shifokorga yozilmoqchiman", "therapy"],
  ])("%s → %s", (q, sp) => expect(detectIntent(q)).toEqual({ type: "find_doctor", specialty: sp }));
  it.each(["qabulga yozilmoqchiman", "ertaga vrach bormi?", "хочу записаться на приём", "нужен врач"])("общий запрос: %s", (q) =>
    expect(detectIntent(q)).toEqual({ type: "find_doctor", specialty: null }),
  );
  it.each(["как получить бесплатные лекарства", "что такое реимбурсация", "нужен рецепт"])("нет намерения: %s", (q) => expect(detectIntent(q)).toBeNull());
});

describe("время Ташкента", () => {
  it("UTC+5", () => {
    expect(localToUtc("2026-11-18", 9 * 60).toISOString()).toBe("2026-11-18T04:00:00.000Z");
    expect(localDate(new Date("2026-11-17T19:30:00Z"))).toBe("2026-11-18"); // 00:30 по Ташкенту
    expect(localHHMM("2026-11-18T04:00:00.000Z")).toBe("09:00");
  });
  it("день недели (0 = Пн)", () => {
    expect(weekdayOf("2026-11-16")).toBe(0);
    expect(weekdayOf("2026-11-22")).toBe(6);
  });
  it("валидация даты", () => {
    expect(isValidDate("2026-11-18")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("18.11.2026")).toBe(false);
    expect(isValidDate(null)).toBe(false);
  });
});

describe("слоты и прогноз", () => {
  it("нарезка дня без хвоста", () => {
    const s = buildDaySlots("2026-11-18", { start_min: 540, end_min: 600, slot_minutes: 20 });
    expect(s.map((x) => x.ordinal)).toEqual([1, 2, 3]);
    expect(buildDaySlots("2026-11-18", { start_min: 540, end_min: 590, slot_minutes: 20 }).length).toBe(2);
  });
  it("номер талона", () => expect(ticketFor("K", 7)).toBe("K-007"));
  it("T ≈ N·t + D (пример из плана: 3·15 + 10 = 55)", () => {
    const now = new Date("2026-11-18T05:00:00Z");
    const r = estimateWait({ ahead: 3, slotMinutes: 15, delayMin: 10, slotStart: new Date("2026-11-18T05:30:00Z"), now });
    expect(r.waitMin).toBe(55);
    expect(r.expectedStart).toBe("2026-11-18T05:55:00.000Z");
  });
  it("приём не раньше времени слота", () => {
    const now = new Date("2026-11-18T05:00:00Z");
    expect(estimateWait({ ahead: 0, slotMinutes: 15, delayMin: 0, slotStart: new Date("2026-11-18T08:00:00Z"), now }).expectedStart).toBe("2026-11-18T08:00:00.000Z");
  });
});

describe("права сотрудников", () => {
  const appt = { status: "checked_in" as const, doctor_id: "d1" };
  it("врач — только свои пациенты", () => {
    expect(canDo({ role: "doctor", doctor_id: "d1" }, "start", appt)).toBeNull();
    expect(canDo({ role: "doctor", doctor_id: "d2" }, "start", appt)).toBe("forbidden");
  });
  it("регистратор не начинает приём, админ может", () => {
    expect(canDo({ role: "registrar", doctor_id: null }, "start", appt)).toBe("forbidden");
    expect(canDo({ role: "admin", doctor_id: null }, "start", appt)).toBeNull();
  });
  it("недопустимый переход", () => expect(canDo({ role: "admin", doctor_id: null }, "finish", appt)).toBe("invalid_transition"));
});

describe("VoiceLab клиент (подменённый fetch)", () => {
  const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

  it("STT: multipart, Idempotency-Key, опрос до completed", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let polls = 0;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/v1/stt")) return ok({ id: "tr_1", status: "queued" }, 202);
      polls++;
      return ok(polls < 2 ? { id: "tr_1", status: "processing" } : { id: "tr_1", status: "completed", transcript: " Menga kardiolog kerak " });
    });
    const text = await transcribe({ apiKey: "vlk_x", fetchImpl: fetchImpl as never, sleep: async () => {} }, new Blob(["aud"], { type: "audio/webm" }), "v.webm", "auto", "idem-1");
    expect(text).toBe("Menga kardiolog kerak");
    expect(calls[0].url).toBe("https://api.voicelab.uz/v1/stt");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer vlk_x");
    expect(h["Idempotency-Key"]).toBe("idem-1");
    const form = calls[0].init.body as FormData;
    expect(form.get("language")).toBe("auto");
    expect(form.get("audio")).toBeInstanceOf(Blob);
    expect(calls[1].url).toBe("https://api.voicelab.uz/v1/stt/transcriptions/tr_1");
  });

  it("STT: failed и таймаут", async () => {
    const failed = vi.fn(async () => ok({ id: "t", status: "failed" }));
    await expect(transcribe({ apiKey: "k", fetchImpl: failed as never, sleep: async () => {} }, new Blob(["a"]), "a.webm", "uz", "i")).rejects.toMatchObject({ code: "voicelab_stt_failed" });
    const stuck = vi.fn(async () => ok({ id: "t", status: "processing" }));
    await expect(transcribe({ apiKey: "k", fetchImpl: stuck as never, sleep: async () => {} }, new Blob(["a"]), "a.webm", "uz", "i", -1)).rejects.toMatchObject({ code: "voicelab_timeout" });
  });

  it("ошибки HTTP переводятся в понятные коды", async () => {
    for (const [status, code] of [[401, "voicelab_auth"], [402, "voicelab_no_credits"], [429, "voicelab_rate_limited"], [500, "voicelab_error"]] as const) {
      const f = vi.fn(async () => new Response("x", { status }));
      await expect(synthesize({ apiKey: "k", fetchImpl: f as never }, "Salom", "uz", "v1", "i")).rejects.toMatchObject({ code });
    }
    const net = vi.fn(async () => {
      throw new Error("down");
    });
    await expect(synthesize({ apiKey: "k", fetchImpl: net as never }, "Salom", "uz", "v1", "i")).rejects.toBeInstanceOf(VoiceLabError);
  });

  it("TTS: только разрешённые поля, ключ идемпотентности в заголовке", async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({ text: "Salom", language: "uz", voice_id: "v1" });
      expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("i-2");
      return new Response(new Uint8Array([82, 73, 70, 70]));
    });
    const wav = await synthesize({ apiKey: "k", fetchImpl: f as never }, "Salom", "uz", "v1", "i-2");
    expect(new Uint8Array(wav)[0]).toBe(82);
  });

  it("выбор голоса: настроенный, иначе первый системный (с кэшем)", async () => {
    expect(await pickVoice({ apiKey: "k" }, "uz", "cfg")).toBe("cfg");
    const f = vi.fn(async () => ok({ data: [{ id: "custom1", kind: "custom" }, { id: "sys1", kind: "system" }] }));
    expect(await pickVoice({ apiKey: "k", fetchImpl: f as never }, "ru")).toBe("sys1");
    expect(await pickVoice({ apiKey: "k", fetchImpl: f as never }, "ru")).toBe("sys1");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("LLM: OpenAI-совместимый формат", async () => {
    const f = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.voicelab.uz/v1/chat/completions");
      const b = JSON.parse(init.body as string);
      expect(b.messages[0]).toEqual({ role: "system", content: "SYS" });
      expect(b.messages[1]).toEqual({ role: "user", content: "q" });
      return ok({ choices: [{ message: { content: "Javob [km-382]" } }] });
    });
    expect(await voicelabChat({ apiKey: "k", fetchImpl: f as never }, "m", "SYS", [{ role: "user", text: "q" }])).toBe("Javob [km-382]");
  });

  it("чат с LLM_PROVIDER=voicelab использует VoiceLab и возвращает намерение", async () => {
    const f = vi.fn(async () => ok({ choices: [{ message: { content: "Ответ [km-382]" } }] }));
    const r = await handleChat(
      { lang: "ru", messages: [{ role: "user", text: "Мне нужен кардиолог, можно бесплатно? куда обратиться" }] },
      { LLM_PROVIDER: "voicelab", VOICELAB_API_KEY: "k", VOICELAB_LLM_MODEL: "m", EXTERNAL_AI_TRANSFER_APPROVED: "true" },
      f as never,
    );
    expect(r.mode).toBe("ai");
    expect(r.intent).toEqual({ type: "find_doctor", specialty: "cardiology" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("без явного разрешения текст симптомов НЕ уходит во внешний ИИ (ответ из базы источников)", async () => {
    const f = vi.fn(async () => ok({ choices: [{ message: { content: "x" } }] }));
    const r = await handleChat(
      { lang: "ru", messages: [{ role: "user", text: "Мне нужен кардиолог, можно бесплатно? куда обратиться" }] },
      { LLM_PROVIDER: "voicelab", VOICELAB_API_KEY: "k", VOICELAB_LLM_MODEL: "m", GEMINI_API_KEY: "g" },
      f as never,
    );
    expect(r.mode).toBe("offline");
    expect(f).not.toHaveBeenCalled();
  });
});
