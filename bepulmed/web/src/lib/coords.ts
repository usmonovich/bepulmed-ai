// Координаты учреждений справочника Ташкента. Определяются на устройстве один раз (нужен интернет), дальше — офлайн:
//  1) сопоставление с данными OpenStreetMap (номер семейной поликлиники + район; профиль центра);
//  2) остальное — системный геокодер Android по адресу (только в приложении).
// Каждая точка проверяется: внутри Ташкента и не дальше 7 км от центра своего района. Сомнительные — отбрасываются.
import { primeFromBundle } from "./offline";
import { DISTRICTS, TASHKENT_FACILITIES, type TkFacility } from "../data/tashkentFacilities";
import type { OsmElement } from "../../../worker/src/overpass";
import { distanceMeters } from "./geo";
import { inTashkent, loadTashkentCache, refreshTashkent } from "./offline";
import { norm } from "./search";

export interface Coord {
  lat: number;
  lon: number;
  src: "osm" | "geocoder";
  /** Объект OSM, с которым сопоставлено учреждение (для часов работы, телефона, сайта). */
  osm?: string;
}

const KEY = "bm_fac_coords_v1";
const MAX_FROM_DISTRICT_M = 7000;
/** Геокодер при неточном адресе часто возвращает «центр Ташкента» — такие точки не используем. */
const CITY_CENTER = { lat: 41.2995, lon: 69.2401 };

export function loadCoords(): Record<string, Coord> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function saveCoords(c: Record<string, Coord>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* хранилище недоступно */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("bm-coords"));
}

/** Убрать точки-«заглушки»: одна и та же координата у 3+ учреждений из геокодера — это не их реальные адреса. */
export function dropSuspicious(c: Record<string, Coord>): Record<string, Coord> {
  const groups = new Map<string, string[]>();
  for (const [id, v] of Object.entries(c)) {
    if (v.src !== "geocoder") continue;
    const k = `${v.lat.toFixed(3)},${v.lon.toFixed(3)}`;
    groups.set(k, [...(groups.get(k) ?? []), id]);
  }
  const out = { ...c };
  for (const ids of groups.values()) if (ids.length >= 3) for (const id of ids) delete out[id];
  return out;
}

/** Точка правдоподобна для этого учреждения. */
export function plausible(f: TkFacility, p: { lat: number; lon: number }, src: Coord["src"] = "osm"): boolean {
  if (src === "geocoder" && distanceMeters(p, CITY_CENTER) < 400) return false;
  if (!inTashkent(p)) return f.district === "region"; // область — вне границ города
  if (!f.district || f.district === "region") return true;
  return distanceMeters(p, DISTRICTS[f.district]) <= MAX_FROM_DISTRICT_M;
}

const GENERIC = new Set(
  ["республиканский", "республиканская", "специализированный", "научно", "практический", "медицинский", "научный", "центр", "нии", "клиника", "институт", "больница", "рснпмц", "рсмц", "и", "по", "борьбе", "со", "имени", "ташкент"].map(norm),
);

/** Номер семейной поликлиники: «№36», «36-sonli». */
export function polyNumber(name: string): string | null {
  const m = /№\s*(\d{1,3})/.exec(name) ?? /(\d{1,3})\s*-?\s*(son|сон)/i.exec(name) ?? /poliklinika\s*№?\s*(\d{1,3})/i.exec(name);
  return m ? m[1] : null;
}

/** Сопоставить справочник с объектами OSM. Возвращает найденные координаты. */
export function matchOsm(elements: readonly OsmElement[], facilities: readonly TkFacility[] = TASHKENT_FACILITIES): Record<string, Coord> {
  const out: Record<string, Coord> = {};
  const pts = elements
    .map((e) => ({ id: `${e.type}/${e.id}`, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, names: [e.tags?.name, e.tags?.["name:ru"], e.tags?.["name:uz"]].filter(Boolean).join(" | ") }))
    .filter((p): p is { id: string; lat: number; lon: number; names: string } => p.lat != null && p.lon != null && Boolean(p.names));
  for (const f of facilities) {
    let best: { id: string; lat: number; lon: number } | null = null;
    if (f.type === "family") {
      const num = polyNumber(f.ru);
      if (!num || /филиал/i.test(f.ru)) continue; // у филиалов в OSM обычно нет отдельной точки с номером
      const cands = pts.filter((p) => {
        const n = norm(p.names);
        return /(poliklin|oilaviy|semeyn|oilaviy)/.test(n) && new RegExp(`(^|\\D)${num}(\\D|$)`).test(p.names) && plausible(f, p);
      });
      if (cands.length && f.district && f.district !== "region") {
        const c = DISTRICTS[f.district];
        best = cands.sort((a, b) => distanceMeters(a, c) - distanceMeters(b, c))[0];
      }
    } else {
      const words = norm(f.ru).split(" ").filter((w) => w.length >= 5 && !GENERIC.has(w));
      if (!words.length) continue;
      let bestScore = 0;
      for (const p of pts) {
        const n = norm(p.names);
        const hit = words.filter((w) => n.includes(w.slice(0, Math.max(5, w.length - 3)))).length;
        const score = hit / words.length;
        if (score > bestScore && score >= 0.75 && plausible(f, p)) {
          bestScore = score;
          best = p;
        }
      }
    }
    if (best) out[f.id] = { lat: best.lat, lon: best.lon, src: "osm", osm: best.id };
  }
  return out;
}

// ---------- Геокодер Android ----------

interface GeoBridge {
  geocode?(id: string, query: string): void;
}

function geocodeNative(f: TkFacility): Promise<{ lat: number; lon: number } | null> {
  const n = (typeof window !== "undefined" ? (window.BepulMedNative as unknown as GeoBridge | undefined) : undefined)?.geocode;
  if (!n) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(null), 15000);
    function on(e: Event) {
      const d = (e as CustomEvent).detail as { id?: string; lat?: number; lon?: number };
      if (d.id !== f.id) return;
      done(typeof d.lat === "number" && typeof d.lon === "number" ? { lat: d.lat, lon: d.lon } : null);
    }
    function done(v: { lat: number; lon: number } | null) {
      clearTimeout(timer);
      window.removeEventListener("bm-geo", on);
      resolve(v);
    }
    window.addEventListener("bm-geo", on);
    const addr = f.address.replace(/\s*\(.*?\)/g, "");
    n.call(window.BepulMedNative, f.id, f.district === "region" ? `Ташкентская область, ${addr}` : `Ташкент, ${addr}`);
  });
}

let running: Promise<number> | null = null;

/** Один раз при наличии интернета: определить координаты всех учреждений и сохранить. Возвращает, сколько известно. */
export function ensureCoords(): Promise<number> {
  running ??= (async () => {
    const coords = loadCoords();
    const missing = () => TASHKENT_FACILITIES.filter((f) => !coords[f.id]);
    if (!missing().length) return Object.keys(coords).length;
    // 1. OpenStreetMap (кэш Ташкента → встроенный снимок → скачать)
    let cache = loadTashkentCache() ?? (await primeFromBundle());
    if (!cache) {
      try {
        cache = await refreshTashkent();
      } catch {
        cache = null;
      }
    }
    if (cache) {
      Object.assign(coords, matchOsm(cache.elements, missing()));
      saveCoords(coords);
    }
    // 2. Геокодер Android по адресу
    for (const f of missing()) {
      const p = await geocodeNative(f);
      if (p && plausible(f, p, "geocoder")) {
        coords[f.id] = { ...p, src: "geocoder" };
        saveCoords(coords);
      }
    }
    const clean = dropSuspicious(coords);
    saveCoords(clean);
    return Object.keys(clean).length;
  })().finally(() => {
    running = null;
  });
  return running;
}
