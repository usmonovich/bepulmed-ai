// Работа без сервера BepulMed: учреждения Ташкента из OpenStreetMap (кэш на устройстве) и ответы чата из базы источников.
// Логика чата и разбор OSM — те же модули, что на сервере (worker/src), без копий.
import { KB, retrieve } from "../../../worker/src/kb";
import { emergencyMessage, triage } from "../../../worker/src/triage";
import { offlineAnswer } from "../../../worker/src/gemini";
import { detectIntent } from "../../../worker/src/intent";
import { buildOverpassQuery, mapOsm, type OsmElement } from "../../../worker/src/overpass";
import type { ChatResponse, Facility } from "./api";
import { distanceMeters } from "./geo";

type Lang = "ru" | "uz";

// ---------- Чат ----------

/** Тот же порядок, что на сервере: сначала экстренные признаки (103/112), потом база официальных источников. */
export function localChat(messages: { role: "user" | "assistant"; text: string }[], lang: Lang): ChatResponse {
  const last = [...messages].reverse().find((m) => m.role === "user")?.text ?? "";
  const t = triage(last);
  if (t.emergency) {
    const em = KB.find((k) => k.id === "emergency")!;
    return { emergency: true, answer: emergencyMessage(lang, t.selfHarm), sources: [{ id: em.id, title: em.title[lang], url: em.url, official: em.official }], mode: "triage", intent: null };
  }
  const intent = detectIntent(last);
  const userContext = messages.filter((m) => m.role === "user").slice(-3).map((m) => m.text).join(" ");
  const direct = retrieve(last);
  const sources = direct.length ? direct : retrieve(userContext);
  const answer =
    intent && !sources.length
      ? lang === "uz"
        ? "Shifokorga yozilish uchun server bilan aloqa kerak. Qaysi shifokor kerakligini bilmasangiz, oilaviy shifokordan boshlang."
        : "Для записи к врачу нужна связь с сервером. Если не знаете, какой специалист нужен, начните с семейного врача (терапевта)."
      : offlineAnswer(lang, sources);
  return {
    emergency: false,
    answer,
    sources: sources.slice(0, 2).map((s) => ({ id: s.id, title: s.title[lang], url: s.url, official: s.official, checked: s.checked })),
    mode: "offline",
    intent,
  };
}

// ---------- Учреждения Ташкента ----------

/** Границы Ташкента (с запасом на пригород): юг, запад, север, восток. */
export const TASHKENT_BBOX = { s: 41.17, w: 69.12, n: 41.43, e: 69.45 } as const;
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const CACHE_KEY = "bm_osm_tashkent_v1";
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const KEEP_TAGS = ["amenity", "healthcare", "name", "name:ru", "name:uz", "addr:street", "addr:housenumber", "addr:full", "phone", "contact:phone", "opening_hours", "website", "contact:website", "operator", "operator:type"];

export interface TashkentCache {
  fetchedAt: string;
  elements: OsmElement[];
}

export const inTashkent = (p: { lat: number; lon: number }) =>
  p.lat >= TASHKENT_BBOX.s && p.lat <= TASHKENT_BBOX.n && p.lon >= TASHKENT_BBOX.w && p.lon <= TASHKENT_BBOX.e;

export function tashkentQuery(): string {
  const b = `(${TASHKENT_BBOX.s},${TASHKENT_BBOX.w},${TASHKENT_BBOX.n},${TASHKENT_BBOX.e})`;
  return `[out:json][timeout:90];(nwr["amenity"~"^(hospital|clinic|doctors|pharmacy)$"]${b};nwr["healthcare"~"^(hospital|urgent_care|centre|clinic|doctor|polyclinic|pharmacy)$"]${b};);out center tags;`;
}

/** Оставляем только нужные поля — кэш помещается в хранилище телефона. */
export function compact(elements: OsmElement[]): OsmElement[] {
  const out: OsmElement[] = [];
  for (const e of elements) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat == null || lon == null || !e.tags) continue;
    const tags: Record<string, string> = {};
    for (const k of KEEP_TAGS) if (e.tags[k]) tags[k] = e.tags[k]!;
    if (!tags.name && !tags["name:ru"] && !tags["name:uz"]) continue;
    out.push({ type: e.type, id: e.id, lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, tags });
  }
  return out;
}

/** Запрос к Overpass прямо с устройства (CORS открыт). Пробуем несколько зеркал по очереди. */
export async function overpass(query: string, fetchImpl: typeof fetch = fetch, timeoutMs = 90000): Promise<OsmElement[]> {
  let lastErr: unknown = null;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchImpl(`${url}?data=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { elements?: OsmElement[] };
      if (!Array.isArray(data.elements)) throw new Error("bad_response");
      return data.elements;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("overpass_unavailable");
}

export function loadTashkentCache(): TashkentCache | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as TashkentCache | null;
    return c && Array.isArray(c.elements) && typeof c.fetchedAt === "string" ? c : null;
  } catch {
    return null;
  }
}

let memoryCache: TashkentCache | null = null;
let inflight: Promise<TashkentCache> | null = null;

/** Скачать все больницы, поликлиники и аптеки Ташкента и сохранить на устройстве. */
export function refreshTashkent(fetchImpl: typeof fetch = fetch): Promise<TashkentCache> {
  inflight ??= overpass(tashkentQuery(), fetchImpl)
    .then((els) => {
      const cache = { fetchedAt: new Date().toISOString(), elements: compact(els) };
      memoryCache = cache;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      } catch {
        /* хранилище переполнено — остаётся в памяти до перезапуска */
      }
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Снимок данных Ташкента, встроенный в приложение при сборке (public/data/tashkent_osm.json). */
export async function bundledTashkent(fetchImpl: typeof fetch = fetch): Promise<TashkentCache | null> {
  try {
    const r = await fetchImpl(`${import.meta.env.BASE_URL ?? "/"}data/tashkent_osm.json`, { cache: "no-store" });
    if (!r.ok) return null;
    const c = (await r.json()) as TashkentCache;
    return Array.isArray(c.elements) && typeof c.fetchedAt === "string" ? c : null;
  } catch {
    return null;
  }
}

/** Первый запуск без интернета: если на телефоне нет данных (или встроенные свежее) — берём встроенный снимок. */
export async function primeFromBundle(fetchImpl: typeof fetch = fetch): Promise<TashkentCache | null> {
  const have = memoryCache ?? loadTashkentCache();
  const b = await bundledTashkent(fetchImpl);
  if (!b) return have;
  if (have && Date.parse(have.fetchedAt) >= Date.parse(b.fetchedAt)) return have;
  memoryCache = b;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(b));
  } catch {
    /* остаётся в памяти */
  }
  return b;
}

/** Данные Ташкента: из кэша; если кэша нет или он старше 30 дней — обновляем (при неудаче — старый кэш). */
export async function tashkentData(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<TashkentCache> {
  const cached = memoryCache ?? loadTashkentCache() ?? (await primeFromBundle(fetchImpl));
  if (cached && now - Date.parse(cached.fetchedAt) < MAX_AGE_MS) return cached;
  try {
    return await refreshTashkent(fetchImpl);
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

export interface LocalFacilities {
  facilities: Facility[];
  from: "tashkent_cache" | "overpass_live";
  fetchedAt: string;
}

/** Учреждения рядом без сервера: в Ташкенте — из сохранённых данных города, в других местах — запрос с устройства. */
export async function facilitiesNearLocal(at: { lat: number; lon: number }, radius: number, lang: Lang, fetchImpl: typeof fetch = fetch): Promise<LocalFacilities> {
  if (inTashkent(at)) {
    const c = await tashkentData(fetchImpl);
    const facilities = (mapOsm(c.elements, lang) as Facility[])
      .filter((f) => distanceMeters(at, f) <= radius)
      .sort((a, b) => distanceMeters(at, a) - distanceMeters(at, b))
      .slice(0, 200);
    return { facilities, from: "tashkent_cache", fetchedAt: c.fetchedAt };
  }
  // Вне Ташкента — запрос к OSM с округлёнными координатами (~1 км): точное местоположение не уходит.
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const els = await overpass(buildOverpassQuery({ lat: r2(at.lat), lon: r2(at.lon), radius: radius + 1000, kinds: ["hospital", "clinic", "pharmacy"] }), fetchImpl, 30000);
  const facilities = (mapOsm(els, lang) as Facility[]).filter((f) => distanceMeters(at, f) <= radius).sort((a, b) => distanceMeters(at, a) - distanceMeters(at, b));
  return { facilities, from: "overpass_live", fetchedAt: new Date().toISOString() };
}
