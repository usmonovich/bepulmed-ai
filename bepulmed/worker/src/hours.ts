// Часы работы: OSM opening_hours и расписание 2GIS → одна недельная модель → «открыто сейчас».
// Время — ташкентское (UTC+5, без перехода на летнее время). Работает на телефоне без интернета.

export type Day = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = понедельник
/** Интервалы в минутах от начала дня; конец > 1440 — работа после полуночи. */
export type Week = [number, number][][];

const OSM_DAYS = ["mo", "tu", "we", "th", "fr", "sa", "su"];
const DGIS_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const RU_DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const UZ_DAYS = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
export const TASHKENT_OFFSET_MIN = 5 * 60;

const empty = (): Week => [[], [], [], [], [], [], []];
const hm = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h <= 24 && mi < 60 ? h * 60 + mi : null;
};

function dayList(spec: string): Day[] | null {
  const out = new Set<Day>();
  for (const part of spec.split(",")) {
    const p = part.trim().toLowerCase();
    const r = /^([a-z]{2})(?:-([a-z]{2}))?$/.exec(p);
    if (!r) return null;
    const a = OSM_DAYS.indexOf(r[1]);
    const b = r[2] ? OSM_DAYS.indexOf(r[2]) : a;
    if (a < 0 || b < 0) return null;
    for (let d = a; ; d = (d + 1) % 7) {
      out.add(d as Day);
      if (d === b) break;
    }
  }
  return [...out];
}

/**
 * Разбор распространённых форм OSM opening_hours: «24/7», «Mo-Fr 08:00-18:00; Sa 09:00-14:00»,
 * «Mo-Su 08:00-23:00», «Mo,We 09:00-13:00,14:00-18:00», «Su off», «08:00-20:00» (каждый день),
 * праздники PH пропускаются. Неизвестный синтаксис → null (часы показываем текстом, без «открыто сейчас»).
 */
export function parseOsmHours(raw: string | undefined | null): Week | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^24\s*\/\s*7$/i.test(s)) return Array.from({ length: 7 }, () => [[0, 1440] as [number, number]]);
  const w = empty();
  let any = false;
  for (let rule of s.split(";")) {
    rule = rule.trim();
    if (!rule) continue;
    if (/^ph\b/i.test(rule)) continue; // праздники — не моделируем
    const m = /^(?:((?:[A-Za-z]{2}(?:-[A-Za-z]{2})?)(?:\s*,\s*[A-Za-z]{2}(?:-[A-Za-z]{2})?)*)\s+)?(.+)$/.exec(rule);
    if (!m) return null;
    const days = m[1] ? dayList(m[1].replace(/\s+/g, "")) : ([0, 1, 2, 3, 4, 5, 6] as Day[]);
    if (!days) return null;
    const times = m[2].trim();
    if (/^(off|closed)$/i.test(times)) {
      for (const d of days) w[d] = [];
      any = true;
      continue;
    }
    if (/^24\s*\/\s*7$/i.test(times) || times === "00:00-24:00") {
      for (const d of days) w[d] = [[0, 1440]];
      any = true;
      continue;
    }
    const spans: [number, number][] = [];
    for (const t of times.split(",")) {
      const r = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(t.trim());
      if (!r) return null;
      const a = hm(r[1]), b = hm(r[2]);
      if (a == null || b == null) return null;
      spans.push([a, b <= a ? b + 1440 : b]);
    }
    for (const d of days) w[d] = spans.map((x) => [x[0], x[1]] as [number, number]);
    any = true;
  }
  return any ? w : null;
}

interface DgisDay {
  working_hours?: { from?: string | null; to?: string | null }[];
}
/** Расписание 2GIS: { Mon: { working_hours: [{from,to}] }, …, is_24x7 }. */
export function parseDgisSchedule(s: Record<string, unknown> | undefined | null): Week | null {
  if (!s) return null;
  if (s.is_24x7 === true) return Array.from({ length: 7 }, () => [[0, 1440] as [number, number]]);
  const w = empty();
  let any = false;
  DGIS_DAYS.forEach((k, d) => {
    const day = s[k] as DgisDay | undefined;
    for (const wh of day?.working_hours ?? []) {
      const a = wh.from ? hm(wh.from) : null;
      const b = wh.to ? hm(wh.to) : null;
      if (a == null || b == null) continue;
      w[d].push([a, b <= a ? b + 1440 : b]);
      any = true;
    }
  });
  return any ? w : null;
}

/** Ташкентские день недели (0 = Пн) и минута дня. */
export function tashkentClock(now: number): { day: Day; min: number } {
  const t = new Date(now + TASHKENT_OFFSET_MIN * 60000);
  return { day: ((t.getUTCDay() + 6) % 7) as Day, min: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

const fmt = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export type OpenStatus =
  | { open: true; allDay: boolean; until?: string; closingSoon: boolean }
  | { open: false; opens?: { day: Day; at: string; today: boolean; tomorrow: boolean } };

export function openStatus(w: Week, now: number): OpenStatus {
  const { day, min } = tashkentClock(now);
  if (w.every((d) => d.length === 1 && d[0][0] === 0 && d[0][1] >= 1440)) return { open: true, allDay: true, closingSoon: false };
  const prev = ((day + 6) % 7) as Day;
  // интервал вчерашнего дня, переходящий за полночь
  for (const [, b] of w[prev]) if (b > 1440 && min < b - 1440) return { open: true, allDay: false, until: fmt(b), closingSoon: b - 1440 - min <= 30 };
  for (const [a, b] of w[day]) if (min >= a && min < b) return { open: true, allDay: false, until: fmt(b), closingSoon: b - min <= 30 };
  for (let k = 0; k < 7; k++) {
    const d = ((day + k) % 7) as Day;
    const next = w[d].map((x) => x[0]).filter((a) => k > 0 || a > min).sort((x, y) => x - y)[0];
    if (next != null) return { open: false, opens: { day: d, at: fmt(next), today: k === 0, tomorrow: k === 1 } };
  }
  return { open: false };
}

export function statusText(st: OpenStatus, lang: "ru" | "uz"): string {
  const ru = lang === "ru";
  if (st.open) {
    if (st.allDay) return ru ? "Круглосуточно" : "Kecha-kunduz";
    return ru ? `Открыто до ${st.until}${st.closingSoon ? " · скоро закроется" : ""}` : `${st.until} gacha ochiq${st.closingSoon ? " · tez yopiladi" : ""}`;
  }
  if (!st.opens) return ru ? "Закрыто" : "Yopiq";
  const when = st.opens.today ? (ru ? "сегодня" : "bugun") : st.opens.tomorrow ? (ru ? "завтра" : "ertaga") : (ru ? RU_DAYS : UZ_DAYS)[st.opens.day];
  return ru ? `Закрыто · откроется ${when} в ${st.opens.at}` : `Yopiq · ${when} ${st.opens.at} da ochiladi`;
}

/** Краткая запись недели: «Пн–Пт 08:00–18:00, Сб 09:00–14:00». */
export function weekText(w: Week, lang: "ru" | "uz"): string {
  if (w.every((d) => d.length === 1 && d[0][0] === 0 && d[0][1] >= 1440)) return lang === "ru" ? "Круглосуточно, без выходных" : "Kecha-kunduz, dam olishsiz";
  const names = lang === "ru" ? RU_DAYS : UZ_DAYS;
  const key = (d: number) => w[d].map(([a, b]) => `${fmt(a)}–${b >= 1440 && a === 0 ? "24:00" : fmt(b)}`).join(", ");
  const parts: string[] = [];
  for (let d = 0; d < 7; ) {
    let e = d;
    while (e + 1 < 7 && key(e + 1) === key(d)) e++;
    const k = key(d);
    parts.push(`${names[d]}${e > d ? "–" + names[e] : ""} ${k || (lang === "ru" ? "выходной" : "dam olish")}`);
    d = e + 1;
  }
  return parts.join(", ");
}
