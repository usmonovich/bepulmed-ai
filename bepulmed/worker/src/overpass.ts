// Поиск медицинских учреждений рядом через OpenStreetMap Overpass API.
// Данные OSM — открытые, но НЕ проверенные командой: в интерфейсе помечаются соответствующе.

export type FacilityKind = "hospital" | "clinic" | "pharmacy";

export interface Facility {
  id: string;
  name: string;
  kind: FacilityKind;
  lat: number;
  lon: number;
  address?: string;
  phone?: string;
  openingHours?: string;
  website?: string;
  /** operator:type из OSM: государственное (бесплатная помощь по прикреплению) или частное. */
  operatorType?: "public" | "private";
  source: "osm";
  verified: false;
}

export interface FacilityQuery {
  lat: number;
  lon: number;
  radius: number;
  kinds: FacilityKind[];
}

export function parseFacilityQuery(url: URL): FacilityQuery | { error: string } {
  const latRaw = url.searchParams.get("lat");
  const lonRaw = url.searchParams.get("lon");
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!latRaw || !lonRaw || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { error: "invalid_coordinates" };
  }
  const r = Number(url.searchParams.get("radius") ?? 3000);
  const radius = Math.min(10000, Math.max(300, Number.isFinite(r) ? Math.round(r) : 3000));
  const allowed: FacilityKind[] = ["hospital", "clinic", "pharmacy"];
  const raw = (url.searchParams.get("kinds") ?? "hospital,clinic,pharmacy").split(",");
  const kinds = allowed.filter((k) => raw.includes(k));
  if (!kinds.length) return { error: "invalid_kinds" };
  return { lat, lon, radius, kinds };
}

export function buildOverpassQuery(q: FacilityQuery): string {
  const around = `(around:${q.radius},${q.lat.toFixed(6)},${q.lon.toFixed(6)})`;
  const parts: string[] = [];
  if (q.kinds.includes("hospital")) parts.push(`nwr["amenity"="hospital"]${around};`, `nwr["healthcare"~"^(hospital|urgent_care)$"]${around};`);
  if (q.kinds.includes("clinic")) parts.push(`nwr["amenity"~"^(clinic|doctors)$"]${around};`, `nwr["healthcare"~"^(centre|clinic|doctor|polyclinic)$"]${around};`);
  if (q.kinds.includes("pharmacy")) parts.push(`nwr["amenity"="pharmacy"]${around};`, `nwr["healthcare"="pharmacy"]${around};`);
  return `[out:json][timeout:20];(${parts.join("")});out center tags 150;`;
}

export interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string | undefined>;
}

function kindOf(tags: Record<string, string | undefined>): FacilityKind {
  if (tags.amenity === "pharmacy" || tags.healthcare === "pharmacy") return "pharmacy";
  if (tags.amenity === "hospital" || tags.healthcare === "hospital" || tags.healthcare === "urgent_care") return "hospital";
  return "clinic";
}

export function mapOsm(elements: readonly OsmElement[], lang: "ru" | "uz"): Facility[] {
  const out: Facility[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const t = el.tags ?? {};
    if (lat == null || lon == null) continue;
    const name = (lang === "uz" ? t["name:uz"] : t["name:ru"]) || t.name || t["name:ru"] || t["name:uz"];
    if (!name) continue; // без названия карточка бесполезна
    const id = `${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(", ");
    out.push({
      id,
      name,
      kind: kindOf(t),
      lat,
      lon,
      address: street || t["addr:full"] || undefined,
      phone: t.phone || t["contact:phone"] || undefined,
      openingHours: t.opening_hours || undefined,
      website: t.website || t["contact:website"] || undefined,
      operatorType: /^(government|public|state|municipal)$/i.test(t["operator:type"] ?? "") ? "public" : /^(private|commercial|business)$/i.test(t["operator:type"] ?? "") ? "private" : undefined,
      source: "osm",
      verified: false,
    });
  }
  return out;
}

export async function fetchFacilities(
  q: FacilityQuery,
  lang: "ru" | "uz",
  endpoint: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Facility[]> {
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "BepulMedAI/1.0 (hackathon MVP)" },
    body: "data=" + encodeURIComponent(buildOverpassQuery(q)),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const data = (await res.json()) as { elements?: OsmElement[] };
  return mapOsm(data.elements ?? [], lang);
}
