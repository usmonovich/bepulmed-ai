// Онлайн-справка без персональных данных.
// Наружу (сервер BepulMed → 2GIS) уходит только общедоступный запрос: название лекарства или учреждения,
// категория и район. Симптомы, возраст, имена, телефоны, ПИНФЛ, точные координаты — никогда.
// Одна и та же проверка выполняется на телефоне (до отправки) и на сервере (при приёме).

export type PlaceKind = "pharmacy" | "clinic" | "hospital" | "dentist" | "lab";
export interface PublicQuery {
  kind: PlaceKind;
  q: string; // «аптека», «Семейная поликлиника 35», «метформин»
  district?: string; // ключ района Ташкента
}

/** Слова о человеке и его состоянии — по ним запрос считается личным и не отправляется. */
// Без \b и lookbehind: в JS \b не знает кириллицу, а lookbehind нет в iOS 15.
const PERSONAL = new RegExp("(^|[^\\p{L}\\p{N}])(я|мне|меня|мой|моя|мое|моё|мои|сын|сына|дочь|дочки|ребен\\p{L}*|ребён\\p{L}*|муж|мужа|жена|жены|мама|мамы|папа|бабушк\\p{L}*|дедушк\\p{L}*|лет|года|болит|болят|боль|боли|температур\\p{L}*|давлени\\p{L}*|кашл\\p{L}*|рвот\\p{L}*|тошн\\p{L}*|сыпь|диагноз\\p{L}*|беремен\\p{L}*|anam|otam|bolam|og\\p{L}*riyapti|isitma|homilador\\p{L}*|men|mening|menga)(?=$|[^\\p{L}\\p{N}])", "iu");
const PII = /\d{5,}|\+?\d[\d\s()-]{7,}\d|@|https?:\/\//; // ПИНФЛ/телефоны/почта/ссылки
const ALLOWED = /^[\p{L}\p{N}\s№.,'‘’`"«»()+-]{2,60}$/u;

export const DISTRICT_KEYS = ["olmazor", "bektemir", "mirobod", "mirzo", "sergeli", "uchtepa", "chilonzor", "shayxontohur", "yunusobod", "yakkasaroy", "yashnobod", "yangihayot"] as const;

export type Check = { ok: true; query: PublicQuery } | { ok: false; reason: "personal" | "pii" | "invalid" };

export function checkPublicQuery(input: { kind?: string; q?: string; district?: string }): Check {
  const kind = input.kind as PlaceKind;
  if (!["pharmacy", "clinic", "hospital", "dentist", "lab"].includes(kind)) return { ok: false, reason: "invalid" };
  const q = (input.q ?? "").replace(/\s+/g, " ").trim();
  if (PII.test(q)) return { ok: false, reason: "pii" };
  if (!ALLOWED.test(q)) return { ok: false, reason: "invalid" };
  if (PERSONAL.test(q.toLowerCase())) return { ok: false, reason: "personal" };
  const district = input.district && (DISTRICT_KEYS as readonly string[]).includes(input.district) ? input.district : undefined;
  return { ok: true, query: { kind, q, district } };
}

/** Центры районов (как в справочнике) — вместо точного местоположения пользователя. */
export const DISTRICT_CENTER: Record<string, { lat: number; lon: number }> = {
  olmazor: { lat: 41.352, lon: 69.214 },
  bektemir: { lat: 41.214, lon: 69.334 },
  mirobod: { lat: 41.288, lon: 69.283 },
  mirzo: { lat: 41.338, lon: 69.336 },
  sergeli: { lat: 41.226, lon: 69.224 },
  uchtepa: { lat: 41.297, lon: 69.172 },
  chilonzor: { lat: 41.276, lon: 69.203 },
  shayxontohur: { lat: 41.326, lon: 69.238 },
  yunusobod: { lat: 41.366, lon: 69.287 },
  yakkasaroy: { lat: 41.287, lon: 69.255 },
  yashnobod: { lat: 41.302, lon: 69.338 },
  yangihayot: { lat: 41.205, lon: 69.205 },
};
export const TASHKENT_CENTER = { lat: 41.3111, lon: 69.2797 };
