// Открытый справочник врачей поликлиник: кто, какой специальности, в какие часы принимает.
// Это не данные пациентов: имя врача, кабинет и часы приёма — служебная публичная информация учреждения.
// Источники: (1) BepulMed — заполняет регистратура подключённой поликлиники (таблицы doctors/doctor_schedules);
//            (2) DMED / DHP FHIR — PractitionerRole (R4 availableTime, R5 availability), после регистрации.
import type { Week } from "./hours";

export type Specialty =
  | "family"
  | "therapy"
  | "pediatrics"
  | "gynecology"
  | "neurology"
  | "cardiology"
  | "endocrinology"
  | "surgery"
  | "ent"
  | "ophthalmology"
  | "dentistry"
  | "dermatology"
  | "urology"
  | "traumatology"
  | "psychiatry"
  | "other";

export const SPECIALTIES: Record<Specialty, { ru: string; uz: string; aliases: string[]; referral: boolean }> = {
  family: { ru: "Семейный врач", uz: "Oilaviy shifokor", aliases: ["семейный", "врач общей практики", "воп", "oilaviy", "umumiy amaliyot"], referral: false },
  therapy: { ru: "Терапевт", uz: "Terapevt", aliases: ["терапевт", "terapevt"], referral: false },
  pediatrics: { ru: "Педиатр", uz: "Pediatr", aliases: ["педиатр", "детский врач", "pediatr", "bolalar shifokori"], referral: false },
  gynecology: { ru: "Акушер-гинеколог", uz: "Akusher-ginekolog", aliases: ["гинеколог", "акушер", "ginekolog", "akusher"], referral: false },
  neurology: { ru: "Невролог", uz: "Nevrolog", aliases: ["невролог", "невропатолог", "nevrolog", "nevropatolog", "asab"], referral: true },
  cardiology: { ru: "Кардиолог", uz: "Kardiolog", aliases: ["кардиолог", "сердце", "kardiolog", "yurak"], referral: true },
  endocrinology: { ru: "Эндокринолог", uz: "Endokrinolog", aliases: ["эндокринолог", "диабет", "щитовидка", "endokrinolog"], referral: true },
  surgery: { ru: "Хирург", uz: "Jarroh", aliases: ["хирург", "jarroh", "xirurg"], referral: true },
  ent: { ru: "ЛОР (оториноларинголог)", uz: "LOR", aliases: ["лор", "ухо горло нос", "отоларинголог", "lor"], referral: true },
  ophthalmology: { ru: "Офтальмолог (окулист)", uz: "Oftalmolog", aliases: ["окулист", "офтальмолог", "глазной", "oftalmolog", "okulist", "ko'z"], referral: true },
  dentistry: { ru: "Стоматолог", uz: "Stomatolog", aliases: ["стоматолог", "зубной", "stomatolog", "tish"], referral: false },
  dermatology: { ru: "Дерматолог", uz: "Dermatolog", aliases: ["дерматолог", "кожный", "dermatolog", "teri"], referral: true },
  urology: { ru: "Уролог", uz: "Urolog", aliases: ["уролог", "urolog"], referral: true },
  traumatology: { ru: "Травматолог", uz: "Travmatolog", aliases: ["травматолог", "travmatolog"], referral: false },
  psychiatry: { ru: "Психиатр / психотерапевт", uz: "Psixiatr", aliases: ["психиатр", "психотерапевт", "psixiatr"], referral: true },
  other: { ru: "Другая специальность", uz: "Boshqa mutaxassislik", aliases: [], referral: true },
};

/** Коды из таблицы doctors.specialty (therapy, cardiology, …) и SNOMED/текст из FHIR → наша специальность. */
export function toSpecialty(code: string | undefined | null): Specialty {
  const c = (code ?? "").toLowerCase().trim();
  if ((SPECIALTIES as Record<string, unknown>)[c]) return c as Specialty;
  for (const [k, v] of Object.entries(SPECIALTIES) as [Specialty, (typeof SPECIALTIES)[Specialty]][]) {
    if (v.aliases.some((a) => c.includes(a)) || c.includes(v.ru.toLowerCase().split(" ")[0])) return k;
  }
  if (/neuro/.test(c)) return "neurology";
  if (/cardio/.test(c)) return "cardiology";
  if (/pediatr/.test(c)) return "pediatrics";
  if (/gyn|obstet/.test(c)) return "gynecology";
  if (/general pract|family/.test(c)) return "family";
  return "other";
}

export interface DoctorPublic {
  id: string;
  name: string;
  specialty: Specialty;
  room?: string;
  week: Week | null;
  note?: string;
  source: "bepulmed" | "dmed";
}

export interface DoctorRow {
  id: string;
  full_name: string;
  specialty: string;
  room: string | null;
  weekday: number | null;
  start_min: number | null;
  end_min: number | null;
}

/** Строки JOIN doctors × doctor_schedules → врачи с недельным расписанием. */
export function doctorsFromRows(rows: readonly DoctorRow[]): DoctorPublic[] {
  const by = new Map<string, DoctorPublic>();
  for (const r of rows) {
    let d = by.get(r.id);
    if (!d) {
      d = { id: r.id, name: r.full_name, specialty: toSpecialty(r.specialty), room: r.room ?? undefined, week: null, source: "bepulmed" };
      by.set(r.id, d);
    }
    if (r.weekday != null && r.start_min != null && r.end_min != null && r.weekday >= 0 && r.weekday <= 6) {
      d.week ??= [[], [], [], [], [], [], []];
      d.week[r.weekday].push([r.start_min, r.end_min]);
    }
  }
  return [...by.values()].sort((a, b) => a.specialty.localeCompare(b.specialty) || a.name.localeCompare(b.name));
}

// ---------- DMED / FHIR PractitionerRole ----------
type J = Record<string, unknown>;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const hm = (s: unknown): number | null => {
  const m = /^(\d{2}):(\d{2})/.exec(String(s ?? ""));
  return m ? +m[1] * 60 + +m[2] : null;
};

function weekFromAvailableTime(list: J[]): Week | null {
  const w: Week = [[], [], [], [], [], [], []];
  let any = false;
  for (const t of list) {
    const days = (Array.isArray(t.daysOfWeek) ? (t.daysOfWeek as string[]) : DAYS).map((d) => DAYS.indexOf(String(d).toLowerCase())).filter((d) => d >= 0);
    const all = t.allDay === true;
    const a = all ? 0 : hm(t.availableStartTime);
    const b = all ? 1440 : hm(t.availableEndTime);
    if (a == null || b == null || b <= a) continue;
    for (const d of days) w[d].push([a, b]);
    any = true;
  }
  return any ? w : null;
}

const text = (v: unknown): string => {
  const o = (v ?? {}) as J;
  if (typeof o.text === "string") return o.text;
  const c = Array.isArray(o.coding) ? (o.coding as J[]) : [];
  return String(c.find((x) => x.display)?.display ?? c[0]?.code ?? "");
};

/** PractitionerRole (R4: availableTime; R5: availability[].availableTime) → врач с расписанием. */
export function doctorsFromFhir(bundle: J): DoctorPublic[] {
  const entries = Array.isArray(bundle.entry) ? (bundle.entry as J[]) : [];
  const res = entries.map((e) => (e.resource ?? {}) as J);
  const people = new Map(res.filter((r) => r.resourceType === "Practitioner").map((p) => [`Practitioner/${p.id}`, p]));
  const out: DoctorPublic[] = [];
  for (const r of res) {
    if (r.resourceType !== "PractitionerRole" || r.active === false) continue;
    const pr = (r.practitioner ?? {}) as J;
    const ref = String(pr.reference ?? "");
    const p = people.get(ref);
    const nm = p && Array.isArray(p.name) ? ((p.name as J[])[0] ?? {}) : {};
    const name = String(pr.display ?? nm.text ?? [nm.family, ...(Array.isArray(nm.given) ? (nm.given as string[]) : [])].filter(Boolean).join(" ")) || "—";
    const spec = Array.isArray(r.specialty) ? text((r.specialty as J[])[0]) : "";
    const r4 = Array.isArray(r.availableTime) ? (r.availableTime as J[]) : [];
    const r5 = Array.isArray(r.availability) ? (r.availability as J[]).flatMap((a) => (Array.isArray(a.availableTime) ? (a.availableTime as J[]) : [])) : [];
    out.push({ id: String(r.id ?? ref), name, specialty: toSpecialty(spec), week: weekFromAvailableTime([...r4, ...r5]), source: "dmed" });
  }
  return out;
}
