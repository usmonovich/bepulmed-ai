// Поиск по справочнику клиник Ташкента (без карты — используется и помощником, и тестами).
import { DISTRICTS, TASHKENT_FACILITIES, type TkFacility } from "../data/tashkentFacilities";
import { loadCoords, type Coord } from "./coords";
import { distanceMeters } from "./geo";
import { norm, search } from "./search";

const facFields = (f: TkFacility) => [
    { text: f.ru, weight: 1 },
    { text: f.uz, weight: 1 },
    { text: (f.keys ?? []).join(" "), weight: 0.85 },
    { text: f.district ? `${DISTRICTS[f.district].ru} ${DISTRICTS[f.district].uz}` : "", weight: 0.75 },
    { text: f.address, weight: 0.7 },
];

const NEAR_WORDS = /blijaysh\w*|ryadom|poblizosti|okolo|menya|yaqin\w*|eng|atrofdagi/g;

/** Ближайшие учреждения с известными координатами (по запросу или все). */
export function nearestFacilities(pos: { lat: number; lon: number }, query = "", coords: Record<string, Coord> = loadCoords()) {
  const q = norm(query).replace(NEAR_WORDS, " ").trim();
  const pool = q ? searchFacilities(q).map((h) => h.item) : TASHKENT_FACILITIES;
  return pool
    .filter((f) => coords[f.id])
    .map((f) => ({ item: f, km: distanceMeters(pos, coords[f.id]) / 1000 }))
    .sort((a, b) => a.km - b.km);
}

/** Сначала строго (совпали все слова: «поликлиника» И «Чиланзар»), если пусто — мягче. */
export function searchFacilities(query: string, list: readonly TkFacility[] = TASHKENT_FACILITIES) {
  const strict = search(list, query, facFields, { minCoverage: 1 });
  return strict.length ? strict : search(list, query, facFields, { minCoverage: 0.5 });
}

