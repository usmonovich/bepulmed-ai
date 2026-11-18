// Справка по учреждениям из 2GIS Places API (официальный API, ключ — секрет DGIS_KEY на сервере).
// Берём: название, адрес, координаты, рубрики, расписание, рейтинг и число отзывов.
// Тексты отзывов в 2GIS — отдельное платное разрешение; показываем рейтинг и ссылку на 2GIS.
import { parseDgisSchedule, type Week } from "./hours";
import { DISTRICT_CENTER, TASHKENT_CENTER, type PublicQuery } from "./publicQuery";

export interface PlaceInfo {
  id: string;
  name: string;
  address?: string;
  lat?: number;
  lon?: number;
  rubrics: string[];
  week: Week | null;
  scheduleNote?: string;
  rating?: number;
  reviews?: number;
  link: string;
  source: "2gis";
}

const KIND_WORD: Record<PublicQuery["kind"], string> = {
  pharmacy: "аптека",
  clinic: "клиника",
  hospital: "больница",
  dentist: "стоматология",
  lab: "лаборатория анализы",
};

export function buildDgisUrl(q: PublicQuery, key: string): string {
  const c = q.district ? DISTRICT_CENTER[q.district] : TASHKENT_CENTER;
  const text = q.q.toLowerCase().includes(KIND_WORD[q.kind].split(" ")[0]) ? q.q : `${KIND_WORD[q.kind]} ${q.q}`.trim();
  const p = new URLSearchParams({
    q: `${text} Ташкент`,
    point: `${c.lon},${c.lat}`,
    radius: q.district ? "4000" : "20000",
    type: "branch",
    sort: "relevance",
    page_size: "10",
    locale: "ru_RU",
    fields: "items.point,items.address,items.rubrics,items.schedule,items.reviews,items.org",
    key,
  });
  return `https://catalog.api.2gis.com/3.0/items?${p}`;
}

type J = Record<string, unknown>;
export function mapDgis(body: J): PlaceInfo[] {
  const items = (((body.result as J | undefined)?.items as J[] | undefined) ?? []).slice(0, 10);
  return items.map((it) => {
    const rv = (it.reviews ?? {}) as J;
    const pt = it.point as { lat?: number; lon?: number } | undefined;
    const name = String(it.name ?? "");
    const rating = Number(rv.general_rating ?? rv.org_rating ?? NaN);
    const reviews = Number(rv.general_review_count ?? rv.org_review_count ?? NaN);
    const sch = it.schedule as J | undefined;
    return {
      id: String(it.id ?? ""),
      name,
      address: (it.address_name as string) || undefined,
      lat: pt?.lat,
      lon: pt?.lon,
      rubrics: ((it.rubrics as J[] | undefined) ?? []).map((r) => String(r.name ?? "")).filter(Boolean),
      week: parseDgisSchedule(sch),
      scheduleNote: (sch?.comment as string) || undefined,
      rating: Number.isFinite(rating) && rating > 0 ? Math.round(rating * 10) / 10 : undefined,
      reviews: Number.isFinite(reviews) && reviews > 0 ? reviews : undefined,
      link: `https://2gis.uz/tashkent/search/${encodeURIComponent(name)}`,
      source: "2gis",
    };
  });
}

export async function lookup2gis(q: PublicQuery, key: string, fetchImpl: typeof fetch = fetch): Promise<PlaceInfo[]> {
  const r = await fetchImpl(buildDgisUrl(q, key), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`2gis_${r.status}`);
  const j = (await r.json()) as J;
  const code = (j.meta as J | undefined)?.code;
  if (code === 404) return []; // «ничего не найдено» в 2GIS приходит как meta.code 404
  if (code !== 200) throw new Error(`2gis_meta_${code}`);
  return mapDgis(j);
}
