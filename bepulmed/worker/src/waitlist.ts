import { BookingError, bookSlot, checkDateInWindow, ensureSlots, getAppointment, getDoctor, type Patient } from "./booking";
import { localDate, localHHMM } from "./time";

/** Сколько минут освободившееся время удерживается для первого в листе ожидания. */
export const OFFER_TTL_MIN = 10;
/** Не предлагаем время, до которого осталось меньше этого (пациент не успеет доехать). */
export const MIN_LEAD_MIN = 15;
export const MAX_WAITLIST_PER_PATIENT = 3;

const ACTIVE_APPT = `('booked','checked_in','in_progress')`;

export interface Offer {
  entryId: string;
  patientKey: string;
  doctorName: string;
  room: string | null;
  startsAt: string;
  expiresAt: string;
}

function isUnique(e: unknown, what: string): boolean {
  const m = String((e as Error)?.message ?? e);
  return m.includes("UNIQUE constraint failed") && m.includes(what);
}

/** SQL-условие «слот удержан предложением из листа ожидания для кого-то другого». */
export const HELD_BY_OTHER_SQL = (slotCol: string, nowParam = "?", keyParam = "?") =>
  `EXISTS(SELECT 1 FROM waitlist w WHERE w.offered_slot_id = ${slotCol} AND w.status = 'offered' AND w.offer_expires_at > ${nowParam} AND w.patient_key <> ${keyParam})`;

/** Свободные будущие слоты дня, не занятые и не удержанные. */
async function freeUnheldSlots(db: D1Database, doctorId: string, date: string, afterIso: string, nowIso: string) {
  const r = await db
    .prepare(
      `SELECT s.id, s.starts_at FROM slots s
       WHERE s.doctor_id = ? AND s.local_date = ? AND s.starts_at > ?
         AND NOT EXISTS(SELECT 1 FROM appointments a WHERE a.slot_id = s.id AND a.status IN ${ACTIVE_APPT})
         AND NOT EXISTS(SELECT 1 FROM waitlist w WHERE w.offered_slot_id = s.id AND w.status = 'offered' AND w.offer_expires_at > ?)
       ORDER BY s.starts_at`,
    )
    .bind(doctorId, date, afterIso, nowIso)
    .all<{ id: number; starts_at: string }>();
  return r.results;
}

/**
 * Обработчик листа ожидания для врача и дня. Идемпотентен, можно вызывать часто:
 * 1) просроченные предложения → expired;
 * 2) каждое свободное время по порядку предлагается первому ожидающему.
 * Гонку двух одновременных вызовов разрешает уникальный индекс one_offer_per_slot.
 */
export async function reconcileWaitlist(db: D1Database, doctorId: string, date: string, now: Date): Promise<Offer[]> {
  const nowIso = now.toISOString();
  const today = localDate(now);
  await db.batch([
    db.prepare("UPDATE waitlist SET status = 'expired', updated_at = ? WHERE doctor_id = ? AND local_date = ? AND status = 'offered' AND offer_expires_at <= ?").bind(nowIso, doctorId, date, nowIso),
    db.prepare("UPDATE waitlist SET status = 'expired', updated_at = ? WHERE doctor_id = ? AND local_date < ? AND status = 'waiting'").bind(nowIso, doctorId, today),
  ]);
  if (date < today) return [];

  const waiting = await db
    .prepare("SELECT id, patient_key FROM waitlist WHERE doctor_id = ? AND local_date = ? AND status = 'waiting' ORDER BY created_at, id")
    .bind(doctorId, date)
    .all<{ id: string; patient_key: string }>();
  if (!waiting.results.length) return [];

  const lead = new Date(now.getTime() + MIN_LEAD_MIN * 60000).toISOString();
  const free = await freeUnheldSlots(db, doctorId, date, lead, nowIso);
  if (!free.length) return [];

  const doctor = await db.prepare("SELECT full_name, room FROM doctors WHERE id = ?").bind(doctorId).first<{ full_name: string; room: string | null }>();
  const expiresAt = new Date(now.getTime() + OFFER_TTL_MIN * 60000).toISOString();
  const offers: Offer[] = [];
  let wi = 0;
  for (const slot of free) {
    while (wi < waiting.results.length) {
      const w = waiting.results[wi++];
      try {
        const r = await db
          .prepare("UPDATE waitlist SET status = 'offered', offered_slot_id = ?, offer_expires_at = ?, updated_at = ? WHERE id = ? AND status = 'waiting'")
          .bind(slot.id, expiresAt, nowIso, w.id)
          .run();
        if (r.meta.changes) {
          offers.push({ entryId: w.id, patientKey: w.patient_key, doctorName: doctor?.full_name ?? "", room: doctor?.room ?? null, startsAt: slot.starts_at, expiresAt });
          break; // слот отдан — к следующему слоту
        }
      } catch (e) {
        if (isUnique(e, "offered_slot_id")) {
          wi--; // слот уже предложен параллельным обработчиком — этот пациент ждёт следующего слота
          break;
        }
        throw e;
      }
    }
    if (wi >= waiting.results.length) break;
  }
  return offers;
}

export async function joinWaitlist(db: D1Database, patient: Patient, doctorId: unknown, rawDate: unknown, now: Date) {
  const doctor = await getDoctor(db, String(doctorId ?? ""));
  if (!doctor) throw new BookingError("doctor_not_found", 404);
  const date = checkDateInWindow(rawDate, now);
  await ensureSlots(db, doctor.id, date);
  await reconcileWaitlist(db, doctor.id, date, now);

  const nowIso = now.toISOString();
  const free = await freeUnheldSlots(db, doctor.id, date, nowIso, nowIso);
  if (free.length) throw new BookingError("slots_available", 409);

  const has = await db
    .prepare(`SELECT 1 FROM appointments WHERE patient_key = ? AND doctor_id = ? AND local_date = ? AND status IN ${ACTIVE_APPT}`)
    .bind(patient.key, doctor.id, date)
    .first();
  if (has) throw new BookingError("already_booked_this_doctor_today", 409);
  const count = await db.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE patient_key = ? AND status IN ('waiting','offered')").bind(patient.key).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_WAITLIST_PER_PATIENT) throw new BookingError("too_many_waitlist", 409);

  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO waitlist (id, doctor_id, clinic_id, local_date, patient_key, patient_label, channel, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)`,
      )
      .bind(id, doctor.id, doctor.clinic_id, date, patient.key, patient.label, patient.channel, nowIso, nowIso)
      .run();
  } catch (e) {
    if (isUnique(e, "patient_key")) throw new BookingError("already_in_waitlist", 409);
    throw e;
  }
  return (await myWaitlist(db, patient.key, now)).find((w) => w.id === id)!;
}

export async function myWaitlist(db: D1Database, patientKey: string, now: Date) {
  const pairs = await db
    .prepare("SELECT DISTINCT doctor_id, local_date FROM waitlist WHERE patient_key = ? AND status IN ('waiting','offered')")
    .bind(patientKey)
    .all<{ doctor_id: string; local_date: string }>();
  for (const p of pairs.results) await reconcileWaitlist(db, p.doctor_id, p.local_date, now);

  const rows = await db
    .prepare(
      `SELECT w.id, w.status, w.local_date, w.created_at, w.doctor_id, w.offer_expires_at, w.appointment_id, w.updated_at,
              s.id AS slot_id, s.starts_at, s.ends_at, d.full_name AS doctor_name, d.specialty, d.room,
              c.name_ru AS clinic_name_ru, c.name_uz AS clinic_name_uz,
              (SELECT COUNT(*) FROM waitlist o WHERE o.doctor_id = w.doctor_id AND o.local_date = w.local_date
                 AND o.status = 'waiting' AND (o.created_at < w.created_at OR (o.created_at = w.created_at AND o.id < w.id))) AS before_me
       FROM waitlist w JOIN doctors d ON d.id = w.doctor_id JOIN clinics c ON c.id = w.clinic_id
       LEFT JOIN slots s ON s.id = w.offered_slot_id
       WHERE w.patient_key = ? AND (w.status IN ('waiting','offered') OR w.updated_at > ?)
       ORDER BY w.local_date, w.created_at LIMIT 20`,
    )
    .bind(patientKey, new Date(now.getTime() - 6 * 3600000).toISOString())
    .all<Record<string, unknown>>();
  return rows.results.map((r) => ({
    id: r.id as string,
    status: r.status as string,
    local_date: r.local_date as string,
    doctor_id: r.doctor_id as string,
    doctor_name: r.doctor_name,
    specialty: r.specialty,
    room: r.room,
    clinic_name_ru: r.clinic_name_ru,
    clinic_name_uz: r.clinic_name_uz,
    position: r.status === "waiting" ? Number(r.before_me) + 1 : null,
    offer: r.status === "offered" ? { slot_id: r.slot_id, starts_at: r.starts_at, ends_at: r.ends_at, expires_at: r.offer_expires_at } : null,
    appointment_id: r.appointment_id ?? null,
  }));
}

async function ownEntry(db: D1Database, patientKey: string, id: string) {
  const w = await db
    .prepare("SELECT id, patient_key, doctor_id, local_date, status, offered_slot_id, offer_expires_at, appointment_id FROM waitlist WHERE id = ?")
    .bind(id)
    .first<{ id: string; patient_key: string; doctor_id: string; local_date: string; status: string; offered_slot_id: number | null; offer_expires_at: string | null; appointment_id: string | null }>();
  if (!w || w.patient_key !== patientKey) throw new BookingError("not_found", 404);
  return w;
}

/** Пациент принимает предложенное время: обычная запись (все проверки и уникальный индекс), затем отметка в листе. */
export async function acceptOffer(db: D1Database, patient: Patient, id: string, idemKey: string, now: Date) {
  let w = await ownEntry(db, patient.key, id);
  if (w.status === "booked" && w.appointment_id) return { appointment: await getAppointment(db, w.appointment_id), replay: true };
  await reconcileWaitlist(db, w.doctor_id, w.local_date, now); // истёкшее предложение станет expired
  w = await ownEntry(db, patient.key, id);
  if (w.status !== "offered" || !w.offered_slot_id) throw new BookingError("offer_expired", 409);

  let res;
  try {
    res = await bookSlot(db, patient, w.offered_slot_id, idemKey, now);
  } catch (e) {
    if (e instanceof BookingError && e.code === "slot_taken") {
      // Крайне редкая гонка: слот заняли до того, как его удержали. Возвращаем пациента в лист, не теряя места.
      await db.prepare("UPDATE waitlist SET status = 'waiting', offered_slot_id = NULL, offer_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'offered'").bind(now.toISOString(), id).run();
    }
    throw e;
  }
  await db
    .prepare("UPDATE waitlist SET status = 'booked', appointment_id = ?, updated_at = ? WHERE id = ? AND status = 'offered'")
    .bind(res.appointment!.id, now.toISOString(), id)
    .run();
  return res;
}

/** Выйти из листа (или отказаться от предложения). Освободившееся время сразу уходит следующему. */
export async function leaveWaitlist(db: D1Database, patientKey: string, id: string, now: Date) {
  const w = await ownEntry(db, patientKey, id);
  if (w.status !== "waiting" && w.status !== "offered") throw new BookingError("cannot_leave", 409);
  await db.prepare("UPDATE waitlist SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('waiting','offered')").bind(now.toISOString(), id).run();
  return { doctorId: w.doctor_id, date: w.local_date };
}

/** Сводка для кабинета клиники. */
export async function waitlistStats(db: D1Database, doctorId: string, date: string, now: Date) {
  const r = await db
    .prepare(
      `SELECT SUM(status = 'waiting') AS waiting, SUM(status = 'offered' AND offer_expires_at > ?) AS offered
       FROM waitlist WHERE doctor_id = ? AND local_date = ?`,
    )
    .bind(now.toISOString(), doctorId, date)
    .first<{ waiting: number | null; offered: number | null }>();
  return { waiting: r?.waiting ?? 0, offered: r?.offered ?? 0 };
}

/** Текст уведомления в Telegram о предложенном времени. */
export function offerMessage(o: Offer, lang: "ru" | "uz" = "ru"): string {
  const t = localHHMM(o.startsAt);
  const until = localHHMM(o.expiresAt);
  return lang === "uz"
    ? `🔔 Bo‘sh vaqt chiqdi: ${o.doctorName}, ${t}. Vaqt siz uchun ${until} gacha band qilingan — ilovada tasdiqlang.`
    : `🔔 Освободилось время: ${o.doctorName}, ${t}. Оно удержано для вас до ${until} — подтвердите в приложении.`;
}

/** Для cron: обработать все листы ожидания с активными записями (ожидание или предложение). */
export async function reconcileAll(db: D1Database, now: Date): Promise<Offer[]> {
  const pairs = await db
    .prepare("SELECT DISTINCT doctor_id, local_date FROM waitlist WHERE status IN ('waiting','offered') LIMIT 200")
    .all<{ doctor_id: string; local_date: string }>();
  const out: Offer[] = [];
  for (const p of pairs.results) out.push(...(await reconcileWaitlist(db, p.doctor_id, p.local_date, now)));
  return out;
}
