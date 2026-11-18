// Навигация без интернета: GPS + встроенная карта. Направление «по прямой» и расстояние,
// обновляются на ходу. Пошаговый маршрут по улицам — в Яндекс Картах / 2GIS (у них свои офлайн-карты).
import { distanceMeters } from "./geo";

export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

const RU = ["на север", "на северо-восток", "на восток", "на юго-восток", "на юг", "на юго-запад", "на запад", "на северо-запад"];
const UZ = ["shimolga", "shimoli-sharqqa", "sharqqa", "janubi-sharqqa", "janubga", "janubi-g‘arbga", "g‘arbga", "shimoli-g‘arbga"];
export const compassWord = (deg: number, lang: "ru" | "uz") => (lang === "ru" ? RU : UZ)[Math.round(deg / 45) % 8];

export interface NavInfo {
  meters: number;
  bearing: number;
  walkMin: number;
  arrived: boolean;
}

/** По прямой; пешком по городу путь обычно в ~1,3 раза длиннее — учитываем во времени. */
export function navInfo(me: { lat: number; lon: number }, to: { lat: number; lon: number }): NavInfo {
  const m = distanceMeters(me, to);
  return { meters: m, bearing: bearing(me, to), walkMin: Math.max(1, Math.round((m * 1.3) / 80)), arrived: m < 40 };
}

/** Внешние навигаторы: маршрут по улицам (работают офлайн, если в них скачана карта). */
export const yandexRoute = (to: { lat: number; lon: number }) => `https://yandex.uz/maps/?rtext=~${to.lat},${to.lon}&rtt=pd`;
/** Любой установленный навигатор: Android — geo: (Яндекс, 2GIS, Google, Organic Maps…), iOS — Apple Карты. */
export function systemNavUrl(to: { lat: number; lon: number; approx?: boolean; address?: string }, name: string): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  // Точка неизвестна — ищем по адресу в навигаторе (не центр района!).
  const q = to.approx && to.address ? `Ташкент, ${to.address.replace(/\s*\(.*?\)/g, "")}, ${name}` : null;
  if (/BepulMedIOS\//.test(ua)) return q ? `https://maps.apple.com/?daddr=${encodeURIComponent(q)}&dirflg=w` : `https://maps.apple.com/?daddr=${to.lat},${to.lon}&dirflg=w`;
  // Android: geo: открывает приложения карт (Яндекс, 2GIS, Google, Organic Maps), а не браузер.
  if (/Android/.test(ua)) return q ? `geo:0,0?q=${encodeURIComponent(q)}` : `geo:${to.lat},${to.lon}?q=${to.lat},${to.lon}(${encodeURIComponent(name)})`;
  return q ? `https://yandex.uz/maps/?text=${encodeURIComponent(q)}` : yandexRoute(to);
}
