import { addDays, isValidDate, localDate, localToUtc, weekdayOf } from "./time";

// Окно записи: сегодня + 13 дней.
export const BOOKING_HORIZON_DAYS = 14;
export const MAX_ACTIVE_PER_PATIENT = 3;
export const ACTIVE = ["booked", "checked_in", "in_progress"] as const;
const ACTIVE_SQL = `('booked','checked_in','in_progress')`;
/** Слот удержан действующим предложением из листа ожидания (см. waitlist.ts). Параметр: текущее время ISO. */
const HELD_SQL = `EXISTS(SELECT 1 FROM waitlist w WHERE w.offered_slot_id = s.id AND w.status = 'offered' AND w.offer_expires_at > ?)`;

export type AppointmentStatus = "booked" | "checked_in" | "in_progress" | "done" | "cancelled" | "no_show";

export interface Patient {
  key: string;
  label: string;
  channel: "telegram" | "demo" | "registry";
}

export class BookingError extends Error {
  constructor(
    public code: string,
    public status: number,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export interface ScheduleRow {
  start_min: number;
  end_min: number;
  slot_minutes: number;
}

/** Чистая функция: слоты дня по шаблону расписания. */
export function buildDaySlots(date: string, s: ScheduleRow) {
  const out: { starts_at: string; ends_at: string; ordinal: number }[] = [];
  let ordinal = 1;
  for (let m = s.start_min; m + s.slot_minutes <= s.end_min; m += s.slot_minutes) {
    out.push({ starts_at: localToUtc(date, m).toISOString(), ends_at: localToUtc(date, m + s.slot_minutes).toISOString(), ordinal: ordinal++ });
  }
  return out;
}

export function ticketFor(prefix: string, ordinal: number): string {
  return `${prefix}-${String(ordinal).padStart(3, "0")}`;
}

/**
 * Прогноз ожидания (ориентировочный): T ≈ N·t + D,
 * N — пациентов впереди, t — длительность слота, D — текущая задержка врача.
 * Ожидаемое начало не раньше времени слота.
 */
export function estimateWait(params: { ahead: number; slotMinutes: number; delayMin: number; slotStart: Date; now: Date }) {
  const { ahead, slotMinutes, delayMin, slotStart, now } = params;
  const waitMin = ahead * slotMinutes + delayMin;
  const byQueue = now.getTime() + waitMin * 60000;
  const bySlot = slotStart.getTime() + delayMin * 60000;
  return { waitMin, expectedStart: new Date(Math.max(byQueue, bySlot)).toISOString() };
}

/** Создаёт недостающие слоты на дату (идемпотентно, INSERT OR IGNORE). */
export async function ensureSlots(db: D1Database, doctorId: string, date: string): Promise<void> {
  const sched = await db
    .prepare("SELECT start_min, end_min, slot_minutes FROM doctor_schedules WHERE doctor_id = ? AND weekday = ?")
    .bind(doctorId, weekdayOf(date))
    .first<ScheduleRow>();
  if (!sched) return;
  const existing = await db.prepare("SELECT COUNT(*) AS n FROM slots WHERE doctor_id = ? AND local_date = ?").bind(doctorId, date).first<{ n: number }>();
  const slots = buildDaySlots(date, sched);
  if ((existing?.n ?? 0) >= slots.length) return;
  const stmt = db.prepare("INSERT OR IGNORE INTO slots (doctor_id, local_date, starts_at, ends_at, ordinal) VALUES (?, ?, ?, ?, ?)");
  await db.batch(slots.map((s) => stmt.bind(doctorId, date, s.starts_at, s.ends_at, s.ordinal)));
}

export function checkDateInWindow(date: unknown, now: Date): string {
  if (!isValidDate(date)) throw new BookingError("invalid_date", 400);
  const today = localDate(now);
  if (date < today || date > addDays(today, BOOKING_HORIZON_DAYS - 1)) throw new BookingError("date_out_of_range", 400);
  return date;
}

export async function listClinics(db: D1Database) {
  const clinics = await db.prepare("SELECT id, name_ru, name_uz, kind, address, phone, lat, lon, is_demo, connected FROM clinics WHERE connected = 1").all();
  const doctors = await db
    .prepare("SELECT d.id, d.clinic_id, d.full_name, d.specialty, d.room FROM doctors d JOIN clinics c ON c.id = d.clinic_id WHERE d.active = 1 AND c.connected = 1 ORDER BY d.full_name")
    .all();
  return (clinics.results as (Record<string, unknown> & { id: string })[]).map((c) => ({
    ...c,
    is_demo: Boolean(c.is_demo),
    connected: Boolean(c.connected),
    doctors: (doctors.results as Record<string, unknown>[]).filter((d) => d.clinic_id === c.id),
  }));
}

export async function getDoctor(db: D1Database, doctorId: string) {
  return db
    .prepare(
      "SELECT d.id, d.clinic_id, d.full_name, d.specialty, d.room, d.ticket_prefix FROM doctors d JOIN clinics c ON c.id = d.clinic_id WHERE d.id = ? AND d.active = 1 AND c.connected = 1",
    )
    .bind(doctorId)
    .first<{ id: string; clinic_id: string; full_name: string; specialty: string; room: string | null; ticket_prefix: string }>();
}

/** Слоты врача на дату с признаком «занято». Данные других пациентов не возвращаются. */
export async function listSlots(db: D1Database, doctorId: string, date: string, now: Date) {
  const doctor = await getDoctor(db, doctorId);
  if (!doctor) throw new BookingError("doctor_not_found", 404);
  await ensureSlots(db, doctorId, date);
  const rows = await db
    .prepare(
      `SELECT s.id, s.starts_at, s.ends_at,
              (EXISTS(SELECT 1 FROM appointments a WHERE a.slot_id = s.id AND a.status IN ${ACTIVE_SQL})
               OR ${HELD_SQL}) AS taken
       FROM slots s WHERE s.doctor_id = ? AND s.local_date = ? ORDER BY s.starts_at`,
    )
    .bind(now.toISOString(), doctorId, date)
    .all<{ id: number; starts_at: string; ends_at: string; taken: number }>();
  const nowIso = now.toISOString();
  return rows.results.map((r) => ({ id: r.id, starts_at: r.starts_at, ends_at: r.ends_at, available: !r.taken && r.starts_at > nowIso }));
}

async function nextFreeSlots(db: D1Database, doctorId: string, afterIso: string, limit = 3) {
  const r = await db
    .prepare(
      `SELECT s.id, s.starts_at, s.ends_at FROM slots s
       WHERE s.doctor_id = ? AND s.starts_at > ?
         AND NOT EXISTS(SELECT 1 FROM appointments a WHERE a.slot_id = s.id AND a.status IN ${ACTIVE_SQL})
         AND NOT ${HELD_SQL}
       ORDER BY s.starts_at LIMIT ?`,
    )
    .bind(doctorId, afterIso, new Date().toISOString(), limit)
    .all<{ id: number; starts_at: string; ends_at: string }>();
  return r.results;
}

function isUnique(e: unknown, what: string): boolean {
  const m = String((e as Error)?.message ?? e);
  return m.includes("UNIQUE constraint failed") && m.includes(what);
}

export async function getAppointment(db: D1Database, id: string) {
  return db
    .prepare(
      `SELECT a.*, s.starts_at, s.ends_at, d.full_name AS doctor_name, d.specialty, d.room, c.name_ru AS clinic_name_ru, c.name_uz AS clinic_name_uz
       FROM appointments a JOIN slots s ON s.id = a.slot_id JOIN doctors d ON d.id = a.doctor_id JOIN clinics c ON c.id = a.clinic_id
       WHERE a.id = ?`,
    )
    .bind(id)
    .first<Record<string, unknown> & { id: string; status: AppointmentStatus; patient_key: string; clinic_id: string; doctor_id: string; starts_at: string; local_date: string; slot_id: number }>();
}

/**
 * Атомарная запись. Проверки до вставки дают понятные ошибки, а окончательную гарантию
 * «один слот — одна активная запись» даёт уникальный индекс в базе: при гонке двух
 * одновременных запросов второй INSERT отклоняется самой базой.
 */
export async function bookSlot(db: D1Database, patient: Patient, slotId: number, idemKey: string, now: Date, opts: { skipPatientLimits?: boolean } = {}) {
  if (!Number.isInteger(slotId) || slotId <= 0) throw new BookingError("invalid_slot", 400);
  if (typeof idemKey !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(idemKey)) throw new BookingError("invalid_idempotency_key", 400);

  const prev = await db.prepare("SELECT id FROM appointments WHERE patient_key = ? AND idem_key = ?").bind(patient.key, idemKey).first<{ id: string }>();
  if (prev) return { appointment: await getAppointment(db, prev.id), replay: true };

  const slot = await db
    .prepare(
      `SELECT s.id, s.doctor_id, s.local_date, s.starts_at, s.ordinal, d.clinic_id, d.ticket_prefix
       FROM slots s JOIN doctors d ON d.id = s.doctor_id JOIN clinics c ON c.id = d.clinic_id
       WHERE s.id = ? AND d.active = 1 AND c.connected = 1`,
    )
    .bind(slotId)
    .first<{ id: number; doctor_id: string; local_date: string; starts_at: string; ordinal: number; clinic_id: string; ticket_prefix: string }>();
  if (!slot) throw new BookingError("slot_not_found", 404);
  if (slot.starts_at <= now.toISOString()) throw new BookingError("slot_in_past", 409);

  // Время, удержанное для пациента из листа ожидания, недоступно остальным (в том числе регистратуре).
  const held = await db
    .prepare("SELECT 1 FROM waitlist WHERE offered_slot_id = ? AND status = 'offered' AND offer_expires_at > ? AND patient_key <> ?")
    .bind(slot.id, now.toISOString(), patient.key)
    .first();
  if (held) throw new BookingError("slot_taken", 409, { alternatives: await nextFreeSlots(db, slot.doctor_id, slot.starts_at > now.toISOString() ? slot.starts_at : now.toISOString()) });

  if (!opts.skipPatientLimits) {
    const active = await db
      .prepare(`SELECT doctor_id, local_date FROM appointments WHERE patient_key = ? AND status IN ${ACTIVE_SQL} AND local_date >= ?`)
      .bind(patient.key, localDate(now))
      .all<{ doctor_id: string; local_date: string }>();
    if (active.results.length >= MAX_ACTIVE_PER_PATIENT) throw new BookingError("too_many_active", 409);
    if (active.results.some((a) => a.doctor_id === slot.doctor_id && a.local_date === slot.local_date)) {
      throw new BookingError("already_booked_this_doctor_today", 409);
    }
  }

  const id = crypto.randomUUID();
  const ts = now.toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO appointments (id, slot_id, doctor_id, clinic_id, local_date, patient_key, patient_label, channel, status, ticket, idem_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?, ?, ?, ?)`,
        )
        .bind(id, slot.id, slot.doctor_id, slot.clinic_id, slot.local_date, patient.key, patient.label, patient.channel, ticketFor(slot.ticket_prefix, slot.ordinal), idemKey, ts, ts),
      db.prepare("INSERT INTO queue_events (appointment_id, type, actor, at) VALUES (?, 'booked', ?, ?)").bind(id, patient.channel === "registry" ? "staff" : "patient", ts),
    ]);
  } catch (e) {
    if (isUnique(e, "idem_key")) {
      const again = await db.prepare("SELECT id FROM appointments WHERE patient_key = ? AND idem_key = ?").bind(patient.key, idemKey).first<{ id: string }>();
      if (again) return { appointment: await getAppointment(db, again.id), replay: true };
    }
    if (isUnique(e, "slot_id")) {
      // Ближайшие свободные слоты после занятого (не раньше текущего момента).
      const after = slot.starts_at > ts ? slot.starts_at : ts;
      throw new BookingError("slot_taken", 409, { alternatives: await nextFreeSlots(db, slot.doctor_id, after) });
    }
    throw e;
  }
  return { appointment: await getAppointment(db, id), replay: false };
}

export async function queueInfo(db: D1Database, appt: { doctor_id: string; local_date: string; starts_at: string; status: AppointmentStatus }, now: Date) {
  if (!(ACTIVE as readonly string[]).includes(appt.status)) return null;
  const ahead = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM appointments a JOIN slots s ON s.id = a.slot_id
       WHERE a.doctor_id = ? AND a.local_date = ? AND a.status IN ${ACTIVE_SQL} AND s.starts_at < ?`,
    )
    .bind(appt.doctor_id, appt.local_date, appt.starts_at)
    .first<{ n: number }>();
  const sched = await db
    .prepare("SELECT slot_minutes FROM doctor_schedules WHERE doctor_id = ? AND weekday = ?")
    .bind(appt.doctor_id, weekdayOf(appt.local_date))
    .first<{ slot_minutes: number }>();
  const delay = await db.prepare("SELECT delay_min FROM doctor_delays WHERE doctor_id = ? AND local_date = ?").bind(appt.doctor_id, appt.local_date).first<{ delay_min: number }>();
  const n = appt.status === "in_progress" ? 0 : ahead?.n ?? 0;
  const est = estimateWait({ ahead: n, slotMinutes: sched?.slot_minutes ?? 15, delayMin: delay?.delay_min ?? 0, slotStart: new Date(appt.starts_at), now });
  return { ahead: n, delayMin: delay?.delay_min ?? 0, ...est };
}

/** Публичное представление записи для пациента: без чужих данных и служебных полей. */
export function publicAppointment(a: Record<string, unknown>) {
  return {
    id: a.id,
    ticket: a.ticket,
    status: a.status,
    starts_at: a.starts_at,
    ends_at: a.ends_at,
    local_date: a.local_date,
    doctor_name: a.doctor_name,
    specialty: a.specialty,
    room: a.room,
    clinic_id: a.clinic_id,
    clinic_name_ru: a.clinic_name_ru,
    clinic_name_uz: a.clinic_name_uz,
    called_at: a.called_at ?? null,
  };
}

export async function myAppointments(db: D1Database, patientKey: string, now: Date) {
  const rows = await db
    .prepare(
      `SELECT a.id FROM appointments a JOIN slots s ON s.id = a.slot_id
       WHERE a.patient_key = ? AND (a.local_date >= ? OR a.status IN ${ACTIVE_SQL})
       ORDER BY s.starts_at LIMIT 20`,
    )
    .bind(patientKey, addDays(localDate(now), -1))
    .all<{ id: string }>();
  const out = [];
  for (const r of rows.results) {
    const a = await getAppointment(db, r.id);
    if (a) out.push({ ...publicAppointment(a), queue: await queueInfo(db, a, now) });
  }
  return out;
}

export async function cancelByPatient(db: D1Database, patientKey: string, id: string, now: Date) {
  const a = await getAppointment(db, id);
  if (!a || a.patient_key !== patientKey) throw new BookingError("not_found", 404); // чужую запись не раскрываем
  if (a.status !== "booked" && a.status !== "checked_in") throw new BookingError("cannot_cancel", 409);
  const ts = now.toISOString();
  const r = await db.batch([
    db.prepare("UPDATE appointments SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('booked','checked_in')").bind(ts, id),
    // changes() > 0 — событие пишется, только если UPDATE действительно изменил запись.
    db.prepare("INSERT INTO queue_events (appointment_id, type, actor, at) SELECT ?, 'cancelled', 'patient', ? WHERE changes() > 0").bind(id, ts),
  ]);
  if (!r[0].meta.changes) throw new BookingError("cannot_cancel", 409);
  return { ok: true };
}
