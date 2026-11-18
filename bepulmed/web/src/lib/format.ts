// Все времена показываем по Ташкенту, независимо от часового пояса телефона.
const TZ = "Asia/Tashkent";

export function hhmm(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function todayTashkent(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

export function nextDays(n: number, now = new Date()): string[] {
  const t = todayTashkent(now);
  return Array.from({ length: n }, (_, i) => addDays(t, i));
}

export function dayLabel(date: string, lang: "ru" | "uz"): { weekday: string; day: string } {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = lang === "uz" ? ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"][d.getUTCDay()] : ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][d.getUTCDay()];
  return { weekday: wd, day: `${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}` };
}

export function longDate(date: string, lang: "ru" | "uz"): string {
  const { weekday, day } = dayLabel(date, lang);
  return `${weekday}, ${day}`;
}

/** Ключ идемпотентности для одной попытки записи (повторные нажатия не создадут дубль). */
export function newIdemKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
