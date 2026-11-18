// Лист ожидания и QR-регистрация — на настоящем локальном D1 с применёнными миграциями.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import worker, { notifyOffers, type Env } from "../src/index";
import { parseCheckInCode, QR_PREFIX, sha256Hex } from "../src/staff";
import { reconcileWaitlist } from "../src/waitlist";
import { addDays, localDate, localToUtc } from "../src/time";

let env: Env;
let dispose: () => Promise<void>;
const T = { reg: "wreg_" + "a".repeat(40), doc: "wdoc_" + "b".repeat(40), other: "woth_" + "c".repeat(40) };
// Отдельные регистраторы для заполнения дней: лимит 120 запросов/мин на сотрудника — это не баг, а защита.
const FILLERS = ["wf1_" + "f".repeat(40), "wf2_" + "g".repeat(40), "wf3_" + "h".repeat(40)];
async function fill(date: string, filler: string): Promise<string[]> {
  const ids: string[] = [];
  for (const s of await slotsOf(DOC, date)) {
    const r = await call("POST", "/api/staff/walk-in", { staff: filler, body: { slotId: s.id, label: "Заполнение" } });
    expect(r.status).toBe(201);
    ids.push(r.body.appointment.id);
  }
  return ids;
}
const uuid = () => crypto.randomUUID();

function workdayAfter(d: string): string {
  let x = addDays(d, 1);
  while (new Date(`${x}T00:00:00Z`).getUTCDay() === 0) x = addDays(x, 1);
  return x;
}
// Второй рабочий день от сегодня: не пересекается с днём, который заполняют тесты booking.int.
const DAY = workdayAfter(workdayAfter(localDate(new Date())));
const DOC = "doc-cardio";

async function call(method: string, path: string, opts: { body?: unknown; patient?: string; staff?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.patient) headers["X-Demo-Patient"] = opts.patient;
  if (opts.staff) headers["Authorization"] = `Bearer ${opts.staff}`;
  const res = await worker.fetch(new Request(`https://t.dev${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
  return { status: res.status, body: (await res.json()) as any };
}
const slotsOf = async (doctor = DOC, date = DAY) => (await call("GET", `/api/doctors/${doctor}/slots?date=${date}`)).body.slots as { id: number; available: boolean; starts_at: string }[];
const join = (patient: string, doctorId = DOC, date = DAY) => call("POST", "/api/waitlist", { patient, body: { doctorId, date } });
const mine = async (patient: string) => (await call("GET", "/api/waitlist/my", { patient })).body.entries as any[];
const schedule = (date = DAY) => call("GET", `/api/staff/schedule?doctorId=${DOC}&date=${date}`, { staff: T.reg });
const idem = () => "k" + uuid().replace(/-/g, "");

const P1 = uuid(), P2 = uuid(), P3 = uuid(), P4 = uuid();
const walkIns: Record<number, string> = {}; // slotId → appointmentId

beforeAll(async () => {
  const p = await getPlatformProxy<Env>({ persist: { path: "/tmp/bepulmed-it/v3" } });
  env = { DB: p.env.DB, PATIENT_DATA_HOST_APPROVED: "true" } as Env; // тестовая БД: явное «хостинг одобрен»
  dispose = p.dispose;
  const db = env.DB!;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO clinics (id, name_ru, name_uz, kind, lat, lon, is_demo, connected) VALUES ('w-other','Другая W','Boshqa W','clinic',41,69,1,1)"),
    db.prepare("INSERT INTO clinic_staff (id, clinic_id, name, role, doctor_id, token_hash) VALUES ('w-reg','demo-clinic','Регистратор W','registrar',NULL,?)").bind(await sha256Hex(T.reg)),
    db.prepare("INSERT INTO clinic_staff (id, clinic_id, name, role, doctor_id, token_hash) VALUES ('w-doc','demo-clinic','Врач W','doctor','doc-cardio',?)").bind(await sha256Hex(T.doc)),
    db.prepare("INSERT INTO clinic_staff (id, clinic_id, name, role, doctor_id, token_hash) VALUES ('w-oth','w-other','Чужой W','admin',NULL,?)").bind(await sha256Hex(T.other)),
    ...(await Promise.all(FILLERS.map(async (t, i) => db.prepare("INSERT INTO clinic_staff (id, clinic_id, name, role, doctor_id, token_hash) VALUES (?, 'demo-clinic', 'Заполнитель', 'registrar', NULL, ?)").bind(`w-f${i}`, await sha256Hex(t))))),
  ]);
});
afterAll(async () => dispose?.());

describe("лист ожидания", () => {
  it("нельзя встать в лист, пока есть свободное время", async () => {
    const r = await join(P1);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("slots_available");
  });

  it("день заполнен → три пациента встают в лист по порядку, дубль отклонён", async () => {
    for (const s of await slotsOf()) {
      const r = await call("POST", "/api/staff/walk-in", { staff: T.reg, body: { slotId: s.id, label: `Пациент ${s.id}` } });
      expect(r.status).toBe(201);
      walkIns[s.id] = r.body.appointment.id;
    }
    expect((await slotsOf()).filter((s) => s.available)).toHaveLength(0);
    expect((await join(P1)).status).toBe(201);
    expect((await join(P2)).status).toBe(201);
    expect((await join(P3)).status).toBe(201);
    const dup = await join(P1);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("already_in_waitlist");
    expect((await mine(P1))[0].position).toBe(1);
    expect((await mine(P3))[0].position).toBe(3);
    expect((await schedule()).body.waitlist).toEqual({ waiting: 3, offered: 0 });
  });

  let freedSlot = 0;
  it("отмена записи → время удерживается для первого в листе и недоступно остальным", async () => {
    freedSlot = Number(Object.keys(walkIns)[10]);
    const c = await call("POST", `/api/staff/appointments/${walkIns[freedSlot]}/action`, { staff: T.reg, body: { action: "cancel", reason: "Пациент позвонил" } });
    expect(c.status).toBe(200);

    const [e1] = await mine(P1);
    expect(e1.status).toBe("offered");
    expect(e1.offer.slot_id).toBe(freedSlot);
    expect((await mine(P2))[0].position).toBe(1);

    expect((await slotsOf()).find((s) => s.id === freedSlot)!.available).toBe(false);
    const steal = await call("POST", "/api/appointments", { patient: P4, body: { slotId: freedSlot, idempotencyKey: idem() } });
    expect(steal.status).toBe(409);
    expect(steal.body.error).toBe("slot_taken");
    const walk = await call("POST", "/api/staff/walk-in", { staff: T.reg, body: { slotId: freedSlot, label: "Обход" } });
    expect(walk.status).toBe(409);

    const sch = (await schedule()).body;
    expect(sch.rows.find((r: any) => r.slot_id === freedSlot).held).toBe(true);
    expect(sch.waitlist).toEqual({ waiting: 2, offered: 1 });
  });

  it("чужое предложение принять нельзя; своё — запись, повтор не создаёт дубль", async () => {
    const [e1] = await mine(P1);
    expect((await call("POST", `/api/waitlist/${e1.id}/accept`, { patient: P2, body: { idempotencyKey: idem() } })).status).toBe(404);
    const key = idem();
    const a = await call("POST", `/api/waitlist/${e1.id}/accept`, { patient: P1, body: { idempotencyKey: key } });
    expect(a.status).toBe(201);
    expect(a.body.appointment.status).toBe("booked");
    const again = await call("POST", `/api/waitlist/${e1.id}/accept`, { patient: P1, body: { idempotencyKey: idem() } });
    expect(again.status).toBe(200);
    expect(again.body.replay).toBe(true);
    expect(again.body.appointment.id).toBe(a.body.appointment.id);
    expect((await mine(P1)).find((e) => e.id === e1.id).status).toBe("booked");
  });

  it("запись на своё удержанное время обычной формой закрывает предложение", async () => {
    const day4 = workdayAfter(workdayAfter(workdayAfter(workdayAfter(DAY))));
    const ids = await fill(day4, FILLERS[2]);
    const x = uuid();
    await join(x, DOC, day4);
    await call("POST", `/api/staff/appointments/${ids[7]}/action`, { staff: T.reg, body: { action: "cancel", reason: "Тест" } });
    const [e] = await mine(x);
    const r = await call("POST", "/api/appointments", { patient: x, body: { slotId: e.offer.slot_id, idempotencyKey: idem() } });
    expect(r.status).toBe(201);
    expect((await mine(x)).find((w) => w.id === e.id).status).toBe("booked");
  });

  it("отказ от предложения сразу передаёт время следующему", async () => {
    const slot2 = Number(Object.keys(walkIns)[20]);
    await call("POST", `/api/staff/appointments/${walkIns[slot2]}/action`, { staff: T.reg, body: { action: "cancel", reason: "Перенос" } });
    const [e2] = await mine(P2);
    expect(e2.status).toBe("offered");
    expect((await call("POST", `/api/waitlist/${e2.id}/leave`, { patient: P2 })).status).toBe(200);
    const [e3] = await mine(P3);
    expect(e3.status).toBe("offered");
    expect(e3.offer.slot_id).toBe(slot2);
  });

  it("просроченное предложение истекает, и время снова доступно всем", async () => {
    const [e3] = await mine(P3);
    await env.DB!.prepare("UPDATE waitlist SET offer_expires_at = ? WHERE id = ?").bind(new Date(Date.now() - 1000).toISOString(), e3.id).run();
    const s = (await slotsOf()).find((x) => x.id === e3.offer.slot_id)!;
    expect(s.available).toBe(true); // в листе больше никого
    expect((await mine(P3)).find((e) => e.id === e3.id).status).toBe("expired");
    const late = await call("POST", `/api/waitlist/${e3.id}/accept`, { patient: P3, body: { idempotencyKey: idem() } });
    expect(late.status).toBe(409);
    expect(late.body.error).toBe("offer_expired");
  });

  it("гонка: 10 параллельных обработчиков, 1 свободный слот, 2 ожидающих → ровно одно предложение", async () => {
    const day2 = workdayAfter(DAY);
    const slots = await slotsOf(DOC, day2);
    await fill(day2, FILLERS[0]);
    const [a, b] = [uuid(), uuid()];
    const ja = await join(a, DOC, day2);
    expect(ja.status).toBe(201);
    expect((await join(b, DOC, day2)).status).toBe(201);
    await env.DB!.prepare("UPDATE appointments SET status = 'cancelled' WHERE slot_id = ?").bind(slots[5].id).run(); // освобождаем в обход обработчика
    const results = await Promise.all(Array.from({ length: 10 }, () => reconcileWaitlist(env.DB!, DOC, day2, new Date())));
    expect(results.flat()).toHaveLength(1);
    const offered = await env.DB!.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE local_date = ? AND status = 'offered'").bind(day2).first<{ n: number }>();
    expect(offered!.n).toBe(1);
  });
});

describe("cron листа ожидания", () => {
  it("scheduled() передаёт истёкшее предложение следующему без запросов пользователей", async () => {
    const day3 = workdayAfter(workdayAfter(workdayAfter(DAY)));
    const ids = await fill(day3, FILLERS[1]);
    const [a, b] = [uuid(), uuid()];
    await join(a, DOC, day3);
    await join(b, DOC, day3);
    await call("POST", `/api/staff/appointments/${ids[3]}/action`, { staff: T.reg, body: { action: "cancel", reason: "Тест крона" } });
    const [ea] = await mine(a);
    expect(ea.status).toBe("offered");
    await env.DB!.prepare("UPDATE waitlist SET offer_expires_at = ? WHERE id = ?").bind(new Date(Date.now() - 1000).toISOString(), ea.id).run();
    await worker.scheduled({}, env);
    const row = await env.DB!.prepare("SELECT status FROM waitlist WHERE patient_key = ? AND local_date = ?").bind(`demo:${b}`, day3).first<{ status: string }>();
    expect(row!.status).toBe("offered");
  });
});

describe("QR-регистрация прихода", () => {
  const today = localDate(new Date());
  async function apptAt(date: string, minute: number) {
    const db = env.DB!;
    const start = localToUtc(date, minute).toISOString();
    const r = await db
      .prepare("INSERT INTO slots (doctor_id, local_date, starts_at, ends_at, ordinal) VALUES ('doc-therapy', ?, ?, ?, ?) RETURNING id")
      .bind(date, start, localToUtc(date, minute + 5).toISOString(), 900 + minute)
      .first<{ id: number }>();
    const id = uuid();
    await db
      .prepare(
        "INSERT INTO appointments (id, slot_id, doctor_id, clinic_id, local_date, patient_key, patient_label, channel, status, ticket, idem_key, created_at, updated_at) VALUES (?, ?, 'doc-therapy', 'demo-clinic', ?, ?, 'QR-пациент', 'demo', 'booked', 'T-9' || ?, ?, ?, ?)",
      )
      .bind(id, r!.id, date, `demo:${uuid()}`, String(minute), uuid(), new Date().toISOString(), new Date().toISOString())
      .run();
    return id;
  }

  it("разбор кода: QR, полный id, короткий код", () => {
    const id = uuid();
    expect(parseCheckInCode(QR_PREFIX + id)).toEqual({ full: id });
    expect(parseCheckInCode(id.toUpperCase())).toEqual({ full: id });
    expect(parseCheckInCode(`${id.slice(0, 4).toUpperCase()}-${id.slice(4, 8).toUpperCase()}`)).toEqual({ short: id.slice(0, 8) });
    expect(parseCheckInCode("hello")).toBeNull();
    expect(parseCheckInCode(42)).toBeNull();
  });

  it("регистратор сканирует QR → «Пришёл», в журнале отметка «QR-код»; повтор отклонён", async () => {
    const id = await apptAt(today, 1431);
    const r = await call("POST", "/api/staff/check-in", { staff: T.reg, body: { code: QR_PREFIX + id } });
    expect(r.status).toBe(200);
    expect(r.body.appointment.status).toBe("checked_in");
    const log = await env.DB!.prepare("SELECT reason, staff_id FROM audit_logs WHERE entity_id = ? AND action = 'check_in'").bind(id).first<{ reason: string; staff_id: string }>();
    expect(log).toEqual({ reason: "QR-код", staff_id: "w-reg" });
    const again = await call("POST", "/api/staff/check-in", { staff: T.reg, body: { code: QR_PREFIX + id } });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("invalid_transition");
  });

  it("короткий код с талона тоже работает", async () => {
    const id = await apptAt(today, 1433);
    const r = await call("POST", "/api/staff/check-in", { staff: T.reg, body: { code: `${id.slice(0, 4)}-${id.slice(4, 8)}`.toUpperCase() } });
    expect(r.status).toBe(200);
    expect(r.body.appointment.id).toBe(id);
  });

  it("права и границы: врач — 403, чужая клиника — 404, не сегодня — 409, мусор — 400", async () => {
    const id = await apptAt(today, 1435);
    expect((await call("POST", "/api/staff/check-in", { staff: T.doc, body: { code: id } })).status).toBe(403);
    expect((await call("POST", "/api/staff/check-in", { staff: T.other, body: { code: id } })).status).toBe(404);
    const tomorrow = await apptAt(addDays(today, 12), 1437); // дата, которую не используют другие тесты
    const nt = await call("POST", "/api/staff/check-in", { staff: T.reg, body: { code: tomorrow } });
    expect(nt.status).toBe(409);
    expect(nt.body.error).toBe("not_today");
    expect((await call("POST", "/api/staff/check-in", { staff: T.reg, body: { code: "<script>" } })).status).toBe(400);
    expect((await call("POST", "/api/staff/check-in", { body: { code: id } })).status).toBe(401);
  });
});

describe("уведомления Telegram о предложении", () => {
  it("отправляет только пациентам Telegram и только при настроенном боте", async () => {
    const calls: any[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const offers = [
      { entryId: "1", patientKey: "tg:12345", doctorName: "Демо-врач Б.", room: "205", startsAt: "2026-11-20T05:00:00.000Z", expiresAt: "2026-11-19T06:10:00.000Z" },
      { entryId: "2", patientKey: "demo:abc", doctorName: "X", room: null, startsAt: "2026-11-20T05:00:00.000Z", expiresAt: "2026-11-19T06:10:00.000Z" },
    ];
    expect(await notifyOffers({} as Env, offers, fake)).toBe(0);
    expect(await notifyOffers({ BOT_TOKEN: "t", WEBAPP_URL: "https://x.dev" } as Env, offers, fake)).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.chat_id).toBe(12345);
    expect(calls[0].body.text).toContain("10:00"); // 05:00 UTC → 10:00 Ташкент
    expect(calls[0].body.text).toContain("Освободилось время");
    expect(calls[0].body.text).toContain("Bo‘sh vaqt chiqdi");
    expect(calls[0].body.reply_markup.inline_keyboard[0][0].web_app.url).toBe("https://x.dev");
  });
});
