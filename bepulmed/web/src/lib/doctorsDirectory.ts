// Врачи поликлиники и часы приёма: BepulMed (опубликовала регистратура) → DMED (если вход выполнен).
// Последний ответ сохраняется на телефоне — страница поликлиники открывается и без интернета.
import { doctorsFromFhir, type DoctorPublic } from "../../../worker/src/doctors";
import { apiBase, isAndroidApp } from "./api";
import { dmedConfig, dmedDoctorsByName, dmedSession } from "./dmed";

const KEY = "bm_doctors_v1";
export interface FacilityDoctors {
  doctors: DoctorPublic[];
  source: "bepulmed" | "dmed" | null;
  checkedAt?: string | null;
  savedAt: number;
  offline?: boolean;
}

function readAll(): Record<string, FacilityDoctors> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, FacilityDoctors>;
  } catch {
    return {};
  }
}
export function cachedDoctors(facilityId: string): FacilityDoctors | null {
  return readAll()[facilityId] ?? null;
}
function save(facilityId: string, v: FacilityDoctors) {
  try {
    const all = readAll();
    all[facilityId] = v;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export async function loadDoctors(facilityId: string, facilityName: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<FacilityDoctors> {
  const cached = cachedDoctors(facilityId);
  const online = typeof navigator === "undefined" || navigator.onLine !== false;
  if (!online) return cached ? { ...cached, offline: true } : { doctors: [], source: null, savedAt: 0, offline: true };
  // 1. BepulMed: опубликованное расписание подключённой поликлиники
  const base = apiBase();
  if (!(isAndroidApp && !base)) {
    try {
      const r = await fetchImpl(`${base}/api/directory/doctors?facility=${encodeURIComponent(facilityId)}`, { credentials: "omit" });
      if (r.ok) {
        const j = (await r.json()) as { doctors: DoctorPublic[]; source: "bepulmed" | null; checkedAt?: string | null };
        if (j.doctors?.length) {
          const v: FacilityDoctors = { doctors: j.doctors, source: "bepulmed", checkedAt: j.checkedAt, savedAt: now };
          save(facilityId, v);
          return v;
        }
      }
    } catch {
      /* сервер недоступен — пробуем дальше */
    }
  }
  // 2. DMED: только если пациент вошёл (токен в памяти)
  try {
    const cfg = dmedConfig();
    const tok = dmedSession(now);
    if (cfg && tok) {
      const b = await dmedDoctorsByName(cfg, tok, facilityName);
      const doctors = b ? doctorsFromFhir(b) : [];
      if (doctors.length) {
        const v: FacilityDoctors = { doctors, source: "dmed", savedAt: now };
        save(facilityId, v);
        return v;
      }
    }
  } catch {
    /* DMED недоступен */
  }
  return cached ? { ...cached, offline: true } : { doctors: [], source: null, savedAt: 0 };
}
