// Онлайн-справка об аптеках и клиниках без персональных данных.
// • «Открыто сейчас» и часы — из OpenStreetMap, считается на телефоне (работает и без интернета).
// • Платно / бесплатно — из OSM operator:type и типа учреждения (это подсказка, не гарантия).
// • Рейтинг, число отзывов, расписание — из 2GIS через сервер BepulMed (ключ хранится на сервере).
//   Наружу уходит только название учреждения и район — ни местоположение, ни симптомы.
import { openStatus, parseOsmHours, statusText, weekText, type OpenStatus, type Week } from "../../../worker/src/hours";
import { checkPublicQuery, DISTRICT_CENTER, type PlaceKind, type PublicQuery } from "../../../worker/src/publicQuery";
import type { PlaceInfo } from "../../../worker/src/places2gis";
import { apiBase, isAndroidApp, type Facility } from "./api";
import type { Lang } from "./i18n";
import { norm } from "./search";

export type { PlaceInfo, PublicQuery };
export { openStatus, statusText, weekText };

export function facilityWeek(f: Pick<Facility, "openingHours">): Week | null {
  return parseOsmHours(f.openingHours);
}

export function facilityStatus(f: Pick<Facility, "openingHours">, now = Date.now()): OpenStatus | null {
  const w = facilityWeek(f);
  return w ? openStatus(w, now) : null;
}

export type Ownership = "free" | "paid" | "unknown";

/** Государственные поликлиники/больницы — бесплатная помощь по прикреплению; частные клиники — платные. */
export function ownership(f: Pick<Facility, "name" | "kind" | "operatorType" | "source">): Ownership {
  if (f.kind === "pharmacy") return "paid";
  if (f.operatorType === "public") return "free";
  if (f.operatorType === "private") return "paid";
  const n = norm(f.name);
  if (/oilaviy|semeyn|gorodsk|rayonn|tumani?|shahar|respublik|davlat|gosudarstv|mnogoprofilnaya tsentraln|ttm|poliklinika ?\d|\d+ ?(son|-?sonli)|n ?\d+ ?(poliklinik|bolnits)/.test(n)) return "free";
  if (/(^| )(klinik|clinic)|medical|med center|medtsentr|meditsinskiy tsentr|stomatolog|dental|lab|diagnost/.test(n)) return "paid";
  return "unknown";
}

export function ownershipText(o: Ownership, lang: Lang): string {
  const ru = lang === "ru";
  return o === "free" ? (ru ? "Гос. · бесплатно по прикреплению" : "Davlat · biriktirilganlarga bepul") : o === "paid" ? (ru ? "Платно" : "Pullik") : ru ? "Форма оплаты неизвестна" : "To‘lov shakli noma’lum";
}

/** Ближайший центр района — вместо точных координат (точка учреждения, а не пользователя). */
export function districtOf(p: { lat: number; lon: number }): string | undefined {
  let best: string | undefined;
  let d = Infinity;
  for (const [k, c] of Object.entries(DISTRICT_CENTER)) {
    const x = (c.lat - p.lat) ** 2 + ((c.lon - p.lon) * Math.cos((p.lat * Math.PI) / 180)) ** 2;
    if (x < d) {
      d = x;
      best = k;
    }
  }
  return d < 0.0016 ? best : undefined; // ~4 км
}

export function kindOfFacility(f: Pick<Facility, "kind" | "name">): PlaceKind {
  if (f.kind === "pharmacy") return "pharmacy";
  if (f.kind === "hospital") return "hospital";
  const n = norm(f.name);
  if (/stomatolog|dental|tish/.test(n)) return "dentist";
  if (/laborator|analiz|diagnost|tahlil/.test(n)) return "lab";
  return "clinic";
}

export type LookupResult = { ok: true; places: PlaceInfo[]; sent: PublicQuery; fetchedAt: string } | { ok: false; error: "no_server" | "not_configured" | "personal" | "network" | "failed"; sent?: PublicQuery };

/** Запрос справки. Проверка на телефоне — до отправки: личные запросы не уходят. */
export async function lookupPlaces(input: { kind: PlaceKind; q: string; district?: string }, fetchImpl: typeof fetch = fetch): Promise<LookupResult> {
  const chk = checkPublicQuery(input);
  if (!chk.ok) return { ok: false, error: "personal" };
  const sent = chk.query;
  const base = apiBase();
  if (isAndroidApp && !base) return { ok: false, error: "no_server", sent };
  const qs = new URLSearchParams({ kind: sent.kind, q: sent.q, ...(sent.district ? { district: sent.district } : {}) });
  try {
    const r = await fetchImpl(`${base}/api/lookup?${qs}`, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (r.status === 503) return { ok: false, error: "not_configured", sent };
    if (r.status === 400) return { ok: false, error: "personal", sent };
    if (!r.ok) return { ok: false, error: "failed", sent };
    const j = (await r.json()) as { places: PlaceInfo[]; fetchedAt: string };
    return { ok: true, places: j.places ?? [], sent, fetchedAt: j.fetchedAt };
  } catch {
    return { ok: false, error: "network", sent };
  }
}

/** Лучшее совпадение по названию среди ответа 2GIS. */
export function bestMatch(name: string, places: PlaceInfo[]): PlaceInfo | undefined {
  const toks = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 1));
  const a = toks(name);
  let best: PlaceInfo | undefined;
  let score = 0;
  for (const p of places) {
    const b = toks(p.name);
    const inter = [...a].filter((w) => b.has(w)).length;
    const s = inter / Math.max(1, Math.min(a.size, b.size));
    if (s > score) {
      score = s;
      best = p;
    }
  }
  return score >= 0.5 ? best : undefined;
}

/** Ссылка на поиск в 2GIS — открывается пользователем в браузере (уходит только название). */
export const dgisSearchLink = (name: string) => `https://2gis.uz/tashkent/search/${encodeURIComponent(name)}`;

/** Официальные и проверенные источники по лекарствам: ссылки, которые человек открывает сам. */
export const MED_SOURCES = [
  { id: "pharm", ru: "Референтная (предельная) цена — pharm.gov.uz", uz: "Referent (cheklangan) narx — pharm.gov.uz", url: "https://pharm.gov.uz", official: true },
  { id: "liki", ru: "Цены и наличие в аптеках Ташкента — liki.uz", uz: "Toshkent dorixonalarida narx va mavjudlik — liki.uz", url: "https://liki.uz/advanced-search", official: false },
] as const;
