import { SPECIALTIES, type Specialty } from "./doctors";
import { BookingError, bookSlot, checkDateInWindow, ensureSlots, getAppointment, getDoctor, type AppointmentStatus } from "./booking";
import { localDate } from "./time";
import { waitlistStats } from "./waitlist";

export type Role = "registrar" | "doctor" | "admin";

export interface Staff {
  id: string;
  clinic_id: string;
  name: string;
  role: Role;
  doctor_id: string | null;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function authStaff(db: D1Database, authHeader: string | null): Promise<Staff | null> {
  const m = /^Bearer\s+([A-Za-z0-9_-]{24,128})$/.exec(authHeader ?? "");
  if (!m) return null;
  return db
    .prepare("SELECT id, clinic_id, name, role, doctor_id FROM clinic_staff WHERE token_hash = ? AND active = 1")
    .bind(await sha256Hex(m[1]))
    .first<Staff>();
}

export type Action = "check_in" | "call" | "start" | "finish" | "no_show" | "cancel";

/**
 * Матрица прав и допустимых переходов. Никто не управляет всем:
 * регистратор — приход, вызов, неявка, отмена с причиной; врач — начало/конец своего приёма;
 * администратор — всё, но каждое действие пишется в журнал.
 */
export const TRANSITIONS: Record<Action, { from: AppointmentStatus[]; to: AppointmentStatus | null; roles: Role[]; reason: boolean }> = {
  check_in: { from: ["booked"], to: "checked_in", roles: ["registrar", "admin"], reason: false },
  call: { from: ["checked_in"], to: null, roles: ["registrar", "doctor", "admin"], reason: false },
  start: { from: ["checked_in"], to: "in_progress", roles: ["doctor", "admin"], reason: false },
  finish: { from: ["in_progress"], to: "done", roles: ["doctor", "admin"], reason: false },
  no_show: { from: ["booked", "checked_in"], to: "no_show", roles: ["registrar", "admin"], reason: false },
  cancel: { from: ["booked", "checked_in"], to: "cancelled", roles: ["registrar", "admin"], reason: true },
};

export function canDo(staff: Pick<Staff, "role" | "doctor_id">, action: Action, appt: { status: AppointmentStatus; doctor_id: string }): string | null {
  const t = TRANSITIONS[action];
  if (!t) return "unknown_action";
  if (!t.roles.includes(staff.role)) return "forbidden";
  if (staff.role === "doctor" && staff.doctor_id !== appt.doctor_id) return "forbidden";
  if (!t.from.includes(appt.status)) return "invalid_transition";
  return null;
}

function cleanReason(r: unknown): string | null {
  if (typeof r !== "string") return null;
  const s = r.trim().replace(/\s+/g, " ").slice(0, 300);
  return s.length >= 3 ? s : null;
}

function audit(db: D1Database, staff: Staff, action: string, entityId: string | null, before: string | null, after: string | null, reason: string | null, ts: string) {
  return db
    .prepare("INSERT INTO audit_logs (clinic_id, staff_id, staff_role, action, entity_id, before_status, after_status, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(staff.clinic_id, staff.id, staff.role, action, entityId, before, after, reason, ts);
}

export async function applyAction(db: D1Database, staff: Staff, apptId: string, action: Action, rawReason: unknown, now: Date) {
  const a = await getAppointment(db, apptId);
  if (!a || a.clinic_id !== staff.clinic_id) throw new BookingError("not_found", 404); // другие клиники невидимы
  const err = canDo(staff, action, a);
  if (err) throw new BookingError(err, err === "forbidden" ? 403 : 409);
  const t = TRANSITIONS[action];
  const reason = cleanReason(rawReason);
  if (t.reason && !reason) throw new BookingError("reason_required", 400);
  if (action === "no_show" && a.starts_at > now.toISOString()) throw new BookingError("too_early_for_no_show", 409);

  const ts = now.toISOString();
  const stampCol = action === "check_in" ? "checked_in_at" : action === "call" ? "called_at" : action === "start" ? "started_at" : action === "finish" ? "finished_at" : null;
  const sets = [t.to ? "status = ?" : null, stampCol ? `${stampCol} = ?` : null, "updated_at = ?"].filter(Boolean).join(", ");
  const binds: unknown[] = [];
  if (t.to) binds.push(t.to);
  if (stampCol) binds.push(ts);
  binds.push(ts, apptId, a.status);

  // Условие status = <прежний> защищает от гонки двух сотрудников, меняющих одну запись.
  // Изменение, событие очереди и запись в журнал — одной транзакцией (batch).
  const res = await db.batch([
    db.prepare(`UPDATE appointments SET ${sets} WHERE id = ? AND status = ?`).bind(...binds),
    db.prepare("INSERT INTO queue_events (appointment_id, type, actor, at) SELECT ?, ?, ?, ? WHERE changes() > 0").bind(apptId, action, `staff:${staff.id}`, ts),
    db
      .prepare(
        "INSERT INTO audit_logs (clinic_id, staff_id, staff_role, action, entity_id, before_status, after_status, reason, at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0",
      )
      .bind(staff.clinic_id, staff.id, staff.role, action, apptId, a.status, t.to ?? a.status, reason, ts),
  ]);
  if (!res[0].meta.changes) throw new BookingError("conflict_retry", 409);
  return getAppointment(db, apptId);
}

export async function setDelay(db: D1Database, staff: Staff, doctorId: string, rawDelay: unknown, now: Date) {
  const doctor = await getDoctor(db, doctorId);
  if (!doctor || doctor.clinic_id !== staff.clinic_id) throw new BookingError("not_found", 404);
  if (staff.role === "doctor" && staff.doctor_id !== doctorId) throw new BookingError("forbidden", 403);
  const delay = Number(rawDelay);
  if (!Number.isInteger(delay) || delay < 0 || delay > 600) throw new BookingError("invalid_delay", 400);
  const date = localDate(now);
  const ts = now.toISOString();
  const prev = await db.prepare("SELECT delay_min FROM doctor_delays WHERE doctor_id = ? AND local_date = ?").bind(doctorId, date).first<{ delay_min: number }>();
  await db.batch([
    db
      .prepare(
        "INSERT INTO doctor_delays (doctor_id, local_date, delay_min, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(doctor_id, local_date) DO UPDATE SET delay_min = excluded.delay_min, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
      )
      .bind(doctorId, date, delay, staff.id, ts),
    audit(db, staff, "set_delay", doctorId, String(prev?.delay_min ?? 0), String(delay), null, ts),
  ]);
  return { doctorId, date, delayMin: delay };
}

/** Запись через регистратуру — для пациентов без смартфона. Метка — имя, которое пациент назвал регистратору. */
export async function walkInBooking(db: D1Database, staff: Staff, slotId: unknown, rawLabel: unknown, now: Date) {
  if (staff.role !== "registrar" && staff.role !== "admin") throw new BookingError("forbidden", 403);
  const label = typeof rawLabel === "string" ? rawLabel.trim().replace(/\s+/g, " ").slice(0, 60) : "";
  if (label.length < 2) throw new BookingError("label_required", 400);
  const sid = Number(slotId);
  const slot = await db.prepare("SELECT d.clinic_id FROM slots s JOIN doctors d ON d.id = s.doctor_id WHERE s.id = ?").bind(sid).first<{ clinic_id: string }>();
  if (!slot || slot.clinic_id !== staff.clinic_id) throw new BookingError("slot_not_found", 404);
  const key = `walkin:${crypto.randomUUID()}`;
  const { appointment } = await bookSlot(db, { key, label, channel: "registry" }, sid, crypto.randomUUID().replace(/-/g, ""), now, { skipPatientLimits: true });
  await audit(db, staff, "walk_in_booking", String(appointment?.id), null, "booked", null, now.toISOString()).run();
  return appointment;
}

/** Расписание дня для регистратуры: все слоты врача и записи на них. */
export async function daySchedule(db: D1Database, staff: Staff, doctorId: string, rawDate: unknown, now: Date) {
  const doctor = await getDoctor(db, doctorId);
  if (!doctor || doctor.clinic_id !== staff.clinic_id) throw new BookingError("not_found", 404);
  const date = rawDate === undefined || rawDate === null || rawDate === "" ? localDate(now) : checkDateInWindow(rawDate, now);
  await ensureSlots(db, doctorId, date);
  const rows = await db
    .prepare(
      `SELECT s.id AS slot_id, s.starts_at, s.ends_at, a.id AS appointment_id, a.ticket, a.status, a.patient_label, a.channel, a.called_at,
              EXISTS(SELECT 1 FROM waitlist w WHERE w.offered_slot_id = s.id AND w.status = 'offered' AND w.offer_expires_at > ?) AS held
       FROM slots s LEFT JOIN appointments a ON a.slot_id = s.id AND a.status IN ('booked','checked_in','in_progress','done','no_show')
       WHERE s.doctor_id = ? AND s.local_date = ? ORDER BY s.starts_at, a.created_at`,
    )
    .bind(now.toISOString(), doctorId, date)
    .all();
  const delay = await db.prepare("SELECT delay_min FROM doctor_delays WHERE doctor_id = ? AND local_date = ?").bind(doctorId, localDate(now)).first<{ delay_min: number }>();
  return { doctor, date, delayMin: delay?.delay_min ?? 0, rows: rows.results.map((r) => ({ ...r, held: Boolean(r.held) })), waitlist: await waitlistStats(db, doctorId, date, now) };
}

export async function auditLog(db: D1Database, staff: Staff, limit = 100) {
  if (staff.role !== "admin") throw new BookingError("forbidden", 403);
  const r = await db
    .prepare(
      `SELECT l.id, l.at, l.action, l.entity_id, l.before_status, l.after_status, l.reason, l.staff_role, st.name AS staff_name
       FROM audit_logs l JOIN clinic_staff st ON st.id = l.staff_id WHERE l.clinic_id = ? ORDER BY l.id DESC LIMIT ?`,
    )
    .bind(staff.clinic_id, Math.min(500, Math.max(1, limit)))
    .all();
  return r.results;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const QR_PREFIX = "BEPULMED:CHECKIN:";

/** Код из QR (`BEPULMED:CHECKIN:<id>`), полный id или 8 символов, напечатанных под QR (`3F9A-21C0`). */
export function parseCheckInCode(raw: unknown): { full: string } | { short: string } | null {
  if (typeof raw !== "string") return null;
  let v = raw.trim().toLowerCase();
  if (v.startsWith(QR_PREFIX.toLowerCase())) v = v.slice(QR_PREFIX.length);
  if (UUID_RE.test(v)) return { full: v };
  const short = v.replace(/[\s-]/g, "");
  return /^[0-9a-f]{8}$/.test(short) ? { short } : null;
}

/** Регистрация прихода по QR-коду талона: только своя клиника и только сегодняшние записи. */
export async function checkInByCode(db: D1Database, staff: Staff, rawCode: unknown, now: Date) {
  const code = parseCheckInCode(rawCode);
  if (!code) throw new BookingError("invalid_code", 400);
  const today = localDate(now);
  const rows = await db
    .prepare(
      "full" in code
        ? "SELECT id, local_date FROM appointments WHERE clinic_id = ? AND id = ?"
        : "SELECT id, local_date FROM appointments WHERE clinic_id = ? AND local_date = ? AND substr(id, 1, 8) = ?",
    )
    .bind(...("full" in code ? [staff.clinic_id, code.full] : [staff.clinic_id, today, code.short]))
    .all<{ id: string; local_date: string }>();
  if (rows.results.length === 0) throw new BookingError("not_found", 404);
  if (rows.results.length > 1) throw new BookingError("ambiguous_code", 409);
  const appt = rows.results[0];
  if (appt.local_date !== today) throw new BookingError("not_today", 409, { date: appt.local_date });
  return applyAction(db, staff, appt.id, "check_in", "QR-код", now);
}

// ---------- Публикация расписания врачей (открытый справочник) ----------

export interface PublishDoctor {
  id?: string;
  fullName: string;
  specialty: Specialty;
  room?: string;
  /** 7 дней (0 = Пн): [начало, конец] в минутах или null — выходной. Один интервал на день. */
  week: ([number, number] | null)[];
}

export function validatePublish(raw: unknown): PublishDoctor[] | string {
  const list = (raw as { doctors?: unknown })?.doctors;
  if (!Array.isArray(list) || list.length < 1 || list.length > 80) return "doctors_1_80";
  const out: PublishDoctor[] = [];
  for (const d of list as Record<string, unknown>[]) {
    const fullName = String(d.fullName ?? "").replace(/\s+/g, " ").trim();
    if (fullName.length < 3 || fullName.length > 80 || /[<>{}]/.test(fullName)) return "bad_name";
    const specialty = String(d.specialty ?? "") as Specialty;
    if (!(specialty in SPECIALTIES)) return "bad_specialty";
    const room = d.room == null ? undefined : String(d.room).trim().slice(0, 12);
    const w = Array.isArray(d.week) ? d.week : [];
    if (w.length !== 7) return "week_7_days";
    const week: ([number, number] | null)[] = [];
    for (const x of w) {
      if (x == null) {
        week.push(null);
        continue;
      }
      const [a, b] = x as number[];
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > 1440 || b <= a) return "bad_time";
      week.push([a, b]);
    }
    const id = d.id == null ? undefined : String(d.id);
    if (id && !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return "bad_id";
    out.push({ id, fullName, specialty, room, week });
  }
  return out;
}

/** Полная замена опубликованного списка врачей клиники (регистратор или администратор). */
export async function publishDirectory(db: D1Database, staff: Staff, raw: unknown, now: Date): Promise<{ published: number }> {
  if (staff.role !== "admin" && staff.role !== "registrar") throw new BookingError("forbidden", 403);
  const v = validatePublish(raw);
  if (typeof v === "string") throw new BookingError(v, 400);
  const at = now.toISOString();
  const existing = await db.prepare("SELECT id FROM doctors WHERE clinic_id = ?").bind(staff.clinic_id).all<{ id: string }>();
  const own = new Set((existing.results ?? []).map((r) => r.id));
  const stmts: D1PreparedStatement[] = [db.prepare("UPDATE doctors SET active = 0 WHERE clinic_id = ?").bind(staff.clinic_id)];
  for (const d of v) {
    if (d.id && !own.has(d.id)) throw new BookingError("doctor_not_in_clinic", 403); // чужого врача не трогаем
    const id = d.id ?? `${staff.clinic_id}-${crypto.randomUUID().slice(0, 8)}`;
    stmts.push(
      db
        .prepare(
          `INSERT INTO doctors (id, clinic_id, full_name, specialty, room, ticket_prefix, active, schedule_checked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)
           ON CONFLICT(id) DO UPDATE SET full_name = ?3, specialty = ?4, room = ?5, active = 1, schedule_checked_at = ?7`,
        )
        .bind(id, staff.clinic_id, d.fullName, d.specialty, d.room ?? null, d.specialty.slice(0, 1).toUpperCase(), at),
      db.prepare("DELETE FROM doctor_schedules WHERE doctor_id = ?").bind(id),
    );
    d.week.forEach((x, day) => {
      if (x) stmts.push(db.prepare("INSERT INTO doctor_schedules (doctor_id, weekday, start_min, end_min, slot_minutes) VALUES (?, ?, ?, ?, 15)").bind(id, day, x[0], x[1]));
    });
  }
  stmts.push(
    db
      .prepare("INSERT INTO audit_logs (clinic_id, staff_id, staff_role, action, entity_id, before_status, after_status, reason, at) VALUES (?, ?, ?, 'publish_directory', NULL, NULL, NULL, ?, ?)")
      .bind(staff.clinic_id, staff.id, staff.role, `${v.length} doctors`, at),
  );
  await db.batch(stmts);
  return { published: v.length };
}
