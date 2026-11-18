// Интеграционные тесты на настоящем локальном D1 (SQLite в workerd) с применёнными миграциями.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import worker, { type Env } from "../src/index";
import { sha256Hex } from "../src/staff";
import { addDays, localDate } from "../src/time";

let env: Env;
let dispose: () => Promise<void>;
const TOKENS = { registrar: "reg_" + "a".repeat(40), doctorT: "doc_" + "b".repeat(40), doctorK: "dok_" + "c".repeat(40), admin: "adm_" + "d".repeat(40), other: "oth_" + "e".repeat(40) };

function nextWorkday(): string {
  let d = addDays(localDate(new Date()), 1);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) d = addDays(d, 1); // воскресенье — выходной
  return d;
}
const DAY = nextWorkday();
const uuid = () => crypto.randomUUID();

async function call(method: string, path: string, opts: { body?: unknown; patient?: string; staff?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.patient) headers["X-Demo-Patient"] = opts.patient;
  if (opts.staff) headers["Authorization"] = `Bearer ${opts.staff}`;
  const res = await worker.fetch(new Request(`https://t.dev${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
  return { status: res.status, body: (await res.json()) as any };
}
const book = (patient: string, slotId: number, key = uuid().replace(/-/g, "")) => call("POST", "/api/appointments", { patient, body: { slotId, idempotencyKey: key } });
async function freeSlots(doctor: string, date = DAY) {
  const r = await call("GET", `/api/doctors/${doctor}/slots?date=${date}`);
  return (r.body.slots as { id: number; available: boolean; starts_at: string }[]).filter((s) => s.available);
}

beforeAll(async () => {
  const p = await getPlatformProxy<Env>({ persist: { path: "/tmp/bepulmed-it/v3" } });
  env = { DB: p.env.DB, PATIENT_DATA_HOST_APPROVED: "true" } as Env; // тестовая БД: явное «хостинг одобрен»
  dispose = p.dispose;
  const db = env.DB!;
  await db.batch([
    db.prepare("INSERT INTO clinics (id, name_ru, name_uz, kind, lat, lon, is_demo, connected) VALUES ('other-clinic','Другая','Boshqa','clinic',41,69,1,1)"),
    db.prepare("INSERT INTO clinic_staff (id, clinic_id, name, role, doctor_id, token_hash) VALUES ('s-reg','demo-clinic','Регистратор','registrar',NULL,?)").bind(await sha256Hex(TOKENS.registrar)),
    db.prepare("INSERT INTO clinic_staff (id, clinic_id, name, role, doctor_id, token_hash) VALUES ('s-docT','demo-clinic','Врач Т','doctor','doc-therapy',?)").bind(await sha256Hex(TOKENS.doctorT)),
    db.prepare("INSERT INTO clinic_staff (id, clinic_id, name, role, doctor_id, token_hash) VALUES ('s-docK','demo-clinic','Врач К','doctor','doc-cardio',?)").bind(await sha256Hex(TOKENS.doctorK)),
    db.prepare("INSERT INTO clinic_staff (id, clinic_id, name, role, doctor_id, token_hash) VALUES ('s-adm','demo-clinic','Админ','admin',NULL,?)").bind(await sha256Hex(TOKENS.admin)),
    db.prepare("INSERT INTO clinic_staff (id, clinic_id, name, role, doctor_id, token_hash) VALUES ('s-oth','other-clinic','Чужой','admin',NULL,?)").bind(await sha256Hex(TOKENS.other)),
  ]);
});
afterAll(async () => dispose?.());

describe("клиники и слоты", () => {
  it("демо-клиника с двумя врачами", async () => {
    const r = await call("GET", "/api/clinics");
    const demo = r.body.clinics.find((c: any) => c.id === "demo-clinic");
    expect(demo.is_demo).toBe(true);
    expect(demo.doctors.map((d: any) => d.specialty).sort()).toEqual(["cardiology", "therapy"]);
  });
  it("слоты генерируются по шаблону и идемпотентно", async () => {
    const a = await call("GET", `/api/doctors/doc-therapy/slots?date=${DAY}`);
    const b = await call("GET", `/api/doctors/doc-therapy/slots?date=${DAY}`);
    expect(a.body.slots.length).toBe(40); // 08:00–18:00 по 15 мин
    expect(b.body.slots.map((s: any) => s.id)).toEqual(a.body.slots.map((s: any) => s.id));
    expect((await call("GET", `/api/doctors/doc-cardio/slots?date=${DAY}`)).body.slots.length).toBe(30);
  });
  it("неверные дата/врач", async () => {
    expect((await call("GET", `/api/doctors/doc-therapy/slots?date=2020-01-01`)).status).toBe(400);
    expect((await call("GET", `/api/doctors/doc-therapy/slots?date=2026-02-30`)).status).toBe(400);
    expect((await call("GET", `/api/doctors/nope/slots?date=${DAY}`)).status).toBe(404);
  });
});

describe("запись пациента", () => {
  it("без идентификации — 401", async () => {
    expect((await call("POST", "/api/appointments", { body: { slotId: 1, idempotencyKey: "x".repeat(10) } })).status).toBe(401);
    expect((await call("GET", "/api/appointments/my", { patient: "not-a-uuid" })).status).toBe(401);
  });

  it("запись, талон, повтор того же запроса не создаёт дубль", async () => {
    const [slot] = await freeSlots("doc-therapy");
    const p = uuid();
    const key = "idem_" + uuid().slice(0, 8);
    const r1 = await book(p, slot.id, key);
    expect(r1.status).toBe(201);
    expect(r1.body.appointment.ticket).toMatch(/^T-\d{3}$/);
    expect(r1.body.appointment.queue.ahead).toBe(0);
    const r2 = await book(p, slot.id, key);
    expect(r2.status).toBe(200);
    expect(r2.body.replay).toBe(true);
    expect(r2.body.appointment.id).toBe(r1.body.appointment.id);
    const my = await call("GET", "/api/appointments/my", { patient: p });
    expect(my.body.appointments.length).toBe(1);
    expect(JSON.stringify(my.body)).not.toContain("patient_key");
  });

  it("10 пациентов одновременно на один слот → ровно одна запись", async () => {
    const slot = (await freeSlots("doc-cardio"))[3];
    const results = await Promise.all(Array.from({ length: 10 }, () => book(uuid(), slot.id)));
    const ok = results.filter((r) => r.status === 201);
    const taken = results.filter((r) => r.status === 409 && r.body.error === "slot_taken");
    expect(ok.length).toBe(1);
    expect(taken.length).toBe(9);
    expect(taken[0].body.alternatives.length).toBeGreaterThan(0);
    expect(taken[0].body.alternatives.map((a: any) => a.id)).not.toContain(slot.id);
    const row = await env.DB!.prepare("SELECT COUNT(*) AS n FROM appointments WHERE slot_id = ? AND status IN ('booked','checked_in','in_progress')").bind(slot.id).first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("второй слот к тому же врачу в тот же день — нельзя; лимит активных записей", async () => {
    const p = uuid();
    const s = await freeSlots("doc-therapy");
    expect((await book(p, s[1].id)).status).toBe(201);
    const again = await book(p, s[2].id);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("already_booked_this_doctor_today");
    expect((await book(p, (await freeSlots("doc-cardio"))[0].id)).status).toBe(201);
    expect((await book(p, (await freeSlots("doc-therapy", nextAfter(DAY)))[0].id)).status).toBe(201);
    const fourth = await book(p, (await freeSlots("doc-cardio", nextAfter(DAY)))[0].id);
    expect(fourth.body.error).toBe("too_many_active");
  });

  it("отмена: чужую — 404, свою — ок, слот снова свободен и его можно занять", async () => {
    const s = (await freeSlots("doc-therapy"))[5];
    const owner = uuid();
    const r = await book(owner, s.id);
    const id = r.body.appointment.id;
    expect((await call("POST", `/api/appointments/${id}/cancel`, { patient: uuid() })).status).toBe(404);
    expect((await call("POST", `/api/appointments/${id}/cancel`, { patient: owner })).status).toBe(200);
    expect((await call("POST", `/api/appointments/${id}/cancel`, { patient: owner })).status).toBe(409);
    expect((await freeSlots("doc-therapy")).some((x) => x.id === s.id)).toBe(true);
    expect((await book(uuid(), s.id)).status).toBe(201);
  });

  it("слот в прошлом и мусорные входные данные", async () => {
    const y = addDays(localDate(new Date()), -1);
    const ins = await env.DB!.prepare("INSERT INTO slots (doctor_id, local_date, starts_at, ends_at, ordinal) VALUES ('doc-therapy', ?, ?, ?, 99) RETURNING id")
      .bind(y, `${y}T05:00:00.000Z`, `${y}T05:15:00.000Z`).first<{ id: number }>();
    expect((await book(uuid(), ins!.id)).body.error).toBe("slot_in_past");
    expect((await book(uuid(), 99999999)).status).toBe(404);
    expect((await call("POST", "/api/appointments", { patient: uuid(), body: { slotId: -1, idempotencyKey: "abcdefgh" } })).status).toBe(400);
    expect((await call("POST", "/api/appointments", { patient: uuid(), body: { slotId: 1, idempotencyKey: "bad key!" } })).status).toBe(400);
  });
});

function nextAfter(d: string): string {
  let x = addDays(d, 1);
  while (new Date(`${x}T00:00:00Z`).getUTCDay() === 0) x = addDays(x, 1);
  return x;
}

describe("кабинет клиники", () => {
  let apptId = "";
  let slotStart = "";

  it("без токена / с неверным токеном — 401", async () => {
    expect((await call("GET", "/api/staff/me")).status).toBe(401);
    expect((await call("GET", "/api/staff/me", { staff: "x".repeat(40) })).status).toBe(401);
  });

  it("регистратор видит запись в расписании (синхронизация пациент → регистратура)", async () => {
    const s = (await freeSlots("doc-therapy"))[0];
    const p = uuid();
    const r = await book(p, s.id);
    apptId = r.body.appointment.id;
    slotStart = s.starts_at;
    const sch = await call("GET", `/api/staff/schedule?doctorId=doc-therapy&date=${DAY}`, { staff: TOKENS.registrar });
    const row = sch.body.rows.find((x: any) => x.appointment_id === apptId);
    expect(row.status).toBe("booked");
    expect(row.patient_label).toMatch(/^Демо-пациент/);
  });

  it("матрица прав и переходов", async () => {
    const act = (tok: string, action: string, reason?: string) => call("POST", `/api/staff/appointments/${apptId}/action`, { staff: tok, body: { action, reason } });
    expect((await act(TOKENS.registrar, "start")).status).toBe(403); // регистратор не начинает приём
    expect((await act(TOKENS.registrar, "finish")).status).toBe(403);
    expect((await act(TOKENS.doctorT, "check_in")).status).toBe(403);
    expect((await act(TOKENS.doctorT, "start")).status).toBe(409); // ещё не пришёл
    expect((await act(TOKENS.registrar, "no_show")).body.error).toBe("too_early_for_no_show");
    expect((await act(TOKENS.registrar, "check_in")).status).toBe(200);
    expect((await act(TOKENS.registrar, "check_in")).status).toBe(409); // повтор
    expect((await act(TOKENS.registrar, "call")).status).toBe(200);
    expect((await act(TOKENS.doctorK, "start")).status).toBe(403); // чужой пациент
    expect((await act(TOKENS.doctorT, "start")).status).toBe(200);
    expect((await act(TOKENS.registrar, "cancel", "передумал")).status).toBe(409); // уже на приёме
    expect((await act(TOKENS.doctorT, "finish")).status).toBe(200);
    expect((await act(TOKENS.other, "cancel", "чужая клиника")).status).toBe(404);
    expect((await call("POST", `/api/staff/appointments/${apptId}/action`, { staff: TOKENS.admin, body: { action: "delete_everything" } })).status).toBe(400);
  });

  it("отмена сотрудником требует причину", async () => {
    const r = await book(uuid(), (await freeSlots("doc-therapy"))[10].id);
    const id = r.body.appointment.id;
    expect((await call("POST", `/api/staff/appointments/${id}/action`, { staff: TOKENS.registrar, body: { action: "cancel" } })).body.error).toBe("reason_required");
    expect((await call("POST", `/api/staff/appointments/${id}/action`, { staff: TOKENS.registrar, body: { action: "cancel", reason: "  " } })).body.error).toBe("reason_required");
    expect((await call("POST", `/api/staff/appointments/${id}/action`, { staff: TOKENS.registrar, body: { action: "cancel", reason: "Пациент позвонил и отменил" } })).status).toBe(200);
  });

  it("задержка врача учитывается в прогнозе (для записи на сегодня)", async () => {
    const today = localDate(new Date());
    const free = await freeSlots("doc-cardio", today).catch(() => []);
    expect((await call("POST", "/api/staff/delay", { staff: TOKENS.registrar, body: { doctorId: "doc-cardio", delayMin: 25 } })).body.delayMin).toBe(25);
    expect((await call("POST", "/api/staff/delay", { staff: TOKENS.registrar, body: { doctorId: "doc-cardio", delayMin: -5 } })).status).toBe(400);
    expect((await call("POST", "/api/staff/delay", { staff: TOKENS.doctorT, body: { doctorId: "doc-cardio", delayMin: 5 } })).status).toBe(403);
    if (free.length) {
      const p = uuid();
      const r = await book(p, free[free.length - 1].id);
      expect(r.body.appointment.queue.delayMin).toBe(25);
      expect(Date.parse(r.body.appointment.queue.expectedStart)).toBeGreaterThanOrEqual(Date.parse(free[free.length - 1].starts_at) + 25 * 60000);
    }
  });

  it("запись через регистратуру для пациента без смартфона", async () => {
    const s = (await freeSlots("doc-cardio"))[0];
    expect((await call("POST", "/api/staff/walk-in", { staff: TOKENS.registrar, body: { slotId: s.id, label: "" } })).status).toBe(400);
    const r = await call("POST", "/api/staff/walk-in", { staff: TOKENS.registrar, body: { slotId: s.id, label: "Каримов А." } });
    expect(r.status).toBe(201);
    expect(r.body.appointment.channel).toBe("registry");
    expect((await call("POST", "/api/staff/walk-in", { staff: TOKENS.registrar, body: { slotId: s.id, label: "Другой" } })).body.error).toBe("slot_taken");
    expect((await call("POST", "/api/staff/walk-in", { staff: TOKENS.doctorK, body: { slotId: s.id, label: "X" } })).status).toBe(403);
    expect((await call("POST", "/api/staff/walk-in", { staff: TOKENS.other, body: { slotId: (await freeSlots("doc-cardio"))[0].id, label: "Чужой" } })).status).toBe(404);
  });

  it("журнал: всё записано, доступ только админу, изменить/удалить нельзя", async () => {
    expect((await call("GET", "/api/staff/audit", { staff: TOKENS.registrar })).status).toBe(403);
    const r = await call("GET", "/api/staff/audit", { staff: TOKENS.admin });
    const actions = r.body.entries.map((e: any) => e.action);
    for (const a of ["check_in", "call", "start", "finish", "cancel", "set_delay", "walk_in_booking"]) expect(actions).toContain(a);
    const cancel = r.body.entries.find((e: any) => e.action === "cancel");
    expect(cancel.reason).toBe("Пациент позвонил и отменил");
    expect(cancel.staff_name).toBe("Регистратор");
    expect(r.body.entries.some((e: any) => e.entity_id === apptId && e.action === "finish" && e.staff_role === "doctor")).toBe(true);
    await expect(env.DB!.prepare("UPDATE audit_logs SET reason = 'подделка'").run()).rejects.toThrow(/append-only/);
    await expect(env.DB!.prepare("DELETE FROM audit_logs").run()).rejects.toThrow(/append-only/);
    // Неудачные попытки (403/409) в журнал не попадают как изменения
    const other = await call("GET", "/api/staff/audit", { staff: TOKENS.other });
    expect(other.body.entries.length).toBe(0);
  });

  it("неявка — только после начала слота; слот освобождается", async () => {
    const y = addDays(localDate(new Date()), -1);
    const slot = await env.DB!.prepare("INSERT INTO slots (doctor_id, local_date, starts_at, ends_at, ordinal) VALUES ('doc-therapy', ?, ?, ?, 98) RETURNING id")
      .bind(y, `${y}T06:00:00.000Z`, `${y}T06:15:00.000Z`).first<{ id: number }>();
    const id = uuid();
    await env.DB!.prepare("INSERT INTO appointments (id, slot_id, doctor_id, clinic_id, local_date, patient_key, patient_label, channel, status, ticket, idem_key, created_at, updated_at) VALUES (?, ?, 'doc-therapy', 'demo-clinic', ?, 'demo:x', 'X', 'demo', 'booked', 'T-098', ?, ?, ?)")
      .bind(id, slot!.id, y, uuid(), new Date().toISOString(), new Date().toISOString()).run();
    const r = await call("POST", `/api/staff/appointments/${id}/action`, { staff: TOKENS.registrar, body: { action: "no_show" } });
    expect(r.status).toBe(200);
    expect(r.body.appointment.status).toBe("no_show");
  });

  it("чужая клиника не видит расписание демо-клиники", async () => {
    expect((await call("GET", `/api/staff/schedule?doctorId=doc-therapy&date=${DAY}`, { staff: TOKENS.other })).status).toBe(404);
  });
});
