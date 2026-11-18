import type { Appointment, WaitlistEntry } from "./api";

/** Последний полученный список талонов — чтобы талон и QR открывались без сети (QR строится локально). */
const KEY = "bm_tickets_v1";

export interface TicketSnapshot {
  at: number;
  appointments: Appointment[];
  waits: WaitlistEntry[];
}

export function saveTickets(appointments: Appointment[], waits: WaitlistEntry[], now = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: now, appointments, waits } satisfies TicketSnapshot));
  } catch {
    /* хранилище недоступно — просто без офлайн-копии */
  }
}

export function loadTickets(): TicketSnapshot | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as TicketSnapshot | null;
    return v && Array.isArray(v.appointments) && typeof v.at === "number" ? { ...v, waits: Array.isArray(v.waits) ? v.waits : [] } : null;
  } catch {
    return null;
  }
}

export function clearTickets(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
