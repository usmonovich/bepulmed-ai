export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(m: number, lang: "ru" | "uz"): string {
  if (m < 1000) return `${Math.round(m)} ${lang === "uz" ? "m" : "м"}`;
  return `${(m / 1000).toFixed(1)} ${lang === "uz" ? "km" : "км"}`;
}

/** Ссылка на маршрут в Яндекс Картах (широко используются в Узбекистане). */
export function routeUrl(from: { lat: number; lon: number } | null, to: { lat: number; lon: number }): string {
  const dest = `${to.lat.toFixed(6)},${to.lon.toFixed(6)}`;
  const rtext = from ? `${from.lat.toFixed(6)},${from.lon.toFixed(6)}~${dest}` : `~${dest}`;
  return `https://yandex.uz/maps/?rtext=${encodeURIComponent(rtext)}&rtt=auto`;
}

/** Номер для tel: — оставляем только цифры и ведущий +; берём первый номер, если их несколько. */
export function telHref(phone: string): string | null {
  const first = phone.split(/[;,]/)[0];
  const clean = first.replace(/(?!^\+)[^\d]/g, "");
  return clean.replace(/\D/g, "").length >= 3 ? `tel:${clean}` : null;
}

export const TASHKENT_CENTER = { lat: 41.311081, lon: 69.240562 };
