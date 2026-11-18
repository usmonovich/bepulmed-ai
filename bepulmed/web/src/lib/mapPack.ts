// Встроенная офлайн-карта Ташкента (векторные тайлы PMTiles, данные © OpenStreetMap, схема Protomaps).
// Файл кладётся в public/maps/ при сборке (scripts/fetch_tashkent_map.sh / GitHub Actions) и
// поставляется внутри APK/iOS. Описание пакета — maps/tashkent.json.
export interface MapPack {
  url: string;
  version: string; // дата данных OSM, например 2026-11-17
  bbox: [number, number, number, number]; // w, s, e, n
  maxzoom: number;
  bytes: number;
  test?: boolean; // тестовый пакет (не настоящие улицы) — только для проверки
}

let cached: Promise<MapPack | null> | null = null;

export function mapPack(fetchImpl: typeof fetch = fetch): Promise<MapPack | null> {
  if (!cached) {
    const base = `${import.meta.env.BASE_URL ?? "/"}maps/`;
    cached = fetchImpl(`${base}tashkent.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Omit<MapPack, "url"> & { file?: string } | null) =>
        j && Array.isArray(j.bbox) && j.maxzoom ? { ...j, url: `${base}${j.file ?? "tashkent.pmtiles"}` } : null,
      )
      .catch(() => null);
  }
  return cached;
}

export const insidePack = (p: MapPack, lat: number, lon: number) => lon >= p.bbox[0] && lat >= p.bbox[1] && lon <= p.bbox[2] && lat <= p.bbox[3];
