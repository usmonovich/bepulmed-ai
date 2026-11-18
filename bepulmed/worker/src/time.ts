// Время Ташкента: UTC+5 круглый год (без перехода на летнее время).
export const TZ_OFFSET_MIN = 5 * 60;

export function localDate(d: Date): string {
  return new Date(d.getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

/** 0 = понедельник … 6 = воскресенье для локальной даты YYYY-MM-DD. */
export function weekdayOf(date: string): number {
  const js = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = воскресенье
  return (js + 6) % 7;
}

/** Локальная дата + минуты от полуночи → момент в UTC. */
export function localToUtc(date: string, minutes: number): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) + (minutes - TZ_OFFSET_MIN) * 60000);
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

export function localHHMM(iso: string): string {
  return new Date(Date.parse(iso) + TZ_OFFSET_MIN * 60000).toISOString().slice(11, 16);
}
