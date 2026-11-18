import { inTelegram, tg } from "./telegram";

const BUILD_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

/** Приложение открыто в нативной оболочке BepulMed (Android APK или iOS) — интерфейс внутри приложения, сервер — по адресу из настроек. */
export const isAndroidApp = typeof navigator !== "undefined" && /BepulMed(Android|IOS)\//.test(navigator.userAgent);
/** Именно iOS-оболочка (WKWebView). */
export const isIOSApp = typeof navigator !== "undefined" && /BepulMedIOS\//.test(navigator.userAgent);

const SERVER_KEY = "bm_server";

/** Адрес сервера, заданный в приложении (только Android-оболочка). */
export function savedServer(): string {
  try {
    return localStorage.getItem(SERVER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function normalizeServer(raw: string): string | null {
  let v = raw.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && !/^(10\.0\.2\.2|localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)$/.test(u.hostname)) return null; // http — только для локальных тестов
    return u.origin;
  } catch {
    return null;
  }
}

export function saveServer(origin: string): void {
  try {
    localStorage.setItem(SERVER_KEY, origin);
  } catch {
    /* хранилище недоступно */
  }
}

/** В Telegram/браузере API на том же адресе, что и страница; в APK — на сервере из настроек. */
export function apiBase(): string {
  return isAndroidApp ? savedServer() : BUILD_BASE;
}

/** Проверка сервера перед сохранением адреса. */
export async function probeServer(origin: string): Promise<Health> {
  let res: Response;
  try {
    res = await fetch(origin + "/api/health", { signal: AbortSignal.timeout(10000) });
  } catch {
    throw new ApiError("network", 0);
  }
  const data = (await res.json().catch(() => null)) as Health | null;
  if (!res.ok || !data?.ok) throw new ApiError("not_bepulmed", res.status);
  return data;
}

export interface Source {
  id: string;
  title: string;
  url: string;
  official: boolean;
  checked?: string;
}

export interface Intent {
  type: "find_doctor";
  specialty: Specialty | null;
}

export interface ChatResponse {
  emergency: boolean;
  answer: string;
  sources: Source[];
  mode: "ai" | "offline" | "triage";
  intent: Intent | null;
}

export interface Facility {
  id: string;
  name: string;
  kind: "hospital" | "clinic" | "pharmacy";
  lat: number;
  lon: number;
  address?: string;
  phone?: string;
  openingHours?: string;
  website?: string;
  operatorType?: "public" | "private";
  source: "osm" | "verified" | "connected";
  verified: boolean;
  checked?: string;
  sourceUrl?: string;
  bookable?: boolean;
  isDemo?: boolean;
}

export type Specialty = "therapy" | "cardiology";

export interface Doctor {
  id: string;
  clinic_id: string;
  full_name: string;
  specialty: Specialty | string;
  room: string | null;
}

export interface Clinic {
  id: string;
  name_ru: string;
  name_uz: string;
  kind: "clinic" | "hospital";
  address: string | null;
  phone: string | null;
  lat: number;
  lon: number;
  is_demo: boolean;
  doctors: Doctor[];
}

export interface Slot {
  id: number;
  starts_at: string;
  ends_at: string;
  available: boolean;
}

export type ApptStatus = "booked" | "checked_in" | "in_progress" | "done" | "cancelled" | "no_show";

export interface Appointment {
  id: string;
  ticket: string;
  status: ApptStatus;
  starts_at: string;
  ends_at: string;
  local_date: string;
  doctor_name: string;
  specialty: string;
  room: string | null;
  clinic_id: string;
  clinic_name_ru: string;
  clinic_name_uz: string;
  called_at: string | null;
  queue: { ahead: number; delayMin: number; waitMin: number; expectedStart: string } | null;
}

export interface Health {
  ok: boolean;
  ai: boolean;
  voice: boolean;
  booking: boolean;
  telegramOnly: boolean;
  patientDataHostApproved?: boolean;
  serverHealthChat?: boolean;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/** Вне Telegram (демо в браузере) — стабильный случайный идентификатор этого устройства. */
export function demoPatientId(): string {
  try {
    let id = localStorage.getItem("bm_patient");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem("bm_patient", id);
    }
    return id;
  } catch {
    return (window as unknown as { __bmPatient?: string }).__bmPatient ??= crypto.randomUUID();
  }
}

function patientHeaders(): Record<string, string> {
  const h: Record<string, string> = { "X-Telegram-Init-Data": tg?.initData ?? "" };
  if (!inTelegram) h["X-Demo-Patient"] = demoPatientId();
  return h;
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 30000): Promise<T> {
  if (isAndroidApp && !savedServer()) throw new ApiError("no_server", 0);
  let res: Response;
  try {
    res = await fetch(apiBase() + path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ApiError("network", 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? "server_error", res.status, data as Record<string, unknown>);
  return data;
}

const jsonInit = (method: string, body?: unknown, extra: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json", ...patientHeaders(), ...extra },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const getHealth = () => request<Health>("/api/health");

export function sendChat(messages: { role: "user" | "assistant"; text: string }[], lang: "ru" | "uz") {
  return request<ChatResponse>("/api/chat", jsonInit("POST", { messages, lang }));
}

export function getFacilities(lat: number, lon: number, lang: "ru" | "uz", radius = 3000) {
  // Точные координаты не отправляем: округление до 0,01° (~1 км) — для поиска в радиусе этого хватает.
  const q = new URLSearchParams({ lat: lat.toFixed(2), lon: lon.toFixed(2), radius: String(radius + 1000), lang });
  return request<{ facilities: Facility[]; source: string; fetchedAt: string }>(`/api/facilities?${q}`, {}, 35000);
}

export const getClinics = () => request<{ clinics: Clinic[] }>("/api/clinics");
export const getSlots = (doctorId: string, date: string) => request<{ date: string; slots: Slot[] }>(`/api/doctors/${encodeURIComponent(doctorId)}/slots?date=${date}`);
export const createAppointment = (slotId: number, idempotencyKey: string) =>
  request<{ appointment: Appointment; replay: boolean }>("/api/appointments", jsonInit("POST", { slotId, idempotencyKey }));
export const myAppointments = () => request<{ appointments: Appointment[] }>("/api/appointments/my", { headers: patientHeaders() });
export interface WaitlistEntry {
  id: string;
  status: "waiting" | "offered" | "booked" | "cancelled" | "expired";
  local_date: string;
  doctor_id: string;
  doctor_name: string;
  specialty: string;
  room: string | null;
  clinic_name_ru: string;
  clinic_name_uz: string;
  position: number | null;
  offer: { slot_id: number; starts_at: string; ends_at: string; expires_at: string } | null;
  appointment_id: string | null;
}
export const joinWaitlist = (doctorId: string, date: string) => request<{ entry: WaitlistEntry }>("/api/waitlist", jsonInit("POST", { doctorId, date }));
export const myWaitlist = () => request<{ entries: WaitlistEntry[] }>("/api/waitlist/my", { headers: patientHeaders() });
export const acceptOffer = (id: string, idempotencyKey: string) =>
  request<{ appointment: Appointment; replay: boolean }>(`/api/waitlist/${id}/accept`, jsonInit("POST", { idempotencyKey }));
export const leaveWaitlist = (id: string) => request<{ ok: boolean }>(`/api/waitlist/${id}/leave`, jsonInit("POST"));

/** Содержимое QR-кода талона для регистрации прихода. */
export const checkInPayload = (appointmentId: string) => `BEPULMED:CHECKIN:${appointmentId}`;
/** Короткий код под QR (первые 8 символов id): регистратор может ввести его вручную. */
export const shortCode = (appointmentId: string) => `${appointmentId.slice(0, 4)}-${appointmentId.slice(4, 8)}`.toUpperCase();

export const cancelAppointment = (id: string) => request<{ ok: boolean }>(`/api/appointments/${id}/cancel`, jsonInit("POST"));

export async function transcribe(audio: Blob, language: "ru" | "uz" | "auto"): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, "voice");
  form.append("language", language);
  const r = await request<{ text: string }>("/api/voice/stt", { method: "POST", body: form, headers: patientHeaders() }, 45000);
  return r.text;
}

export async function speak(text: string, lang: "ru" | "uz"): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(apiBase() + "/api/voice/tts", { ...jsonInit("POST", { text: text.slice(0, 600), lang }), signal: AbortSignal.timeout(40000) });
  } catch {
    throw new ApiError("network", 0);
  }
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(d.error ?? "server_error", res.status);
  }
  return res.blob();
}

// ---------- Кабинет клиники ----------
export interface StaffInfo {
  staff: { id: string; clinic_id: string; name: string; role: "registrar" | "doctor" | "admin"; doctor_id: string | null };
  clinic: Clinic | null;
}
export interface ScheduleRow {
  slot_id: number;
  starts_at: string;
  ends_at: string;
  appointment_id: string | null;
  ticket: string | null;
  status: ApptStatus | null;
  patient_label: string | null;
  channel: string | null;
  called_at: string | null;
  held: boolean;
}
export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  entity_id: string | null;
  before_status: string | null;
  after_status: string | null;
  reason: string | null;
  staff_role: string;
  staff_name: string;
}

const staffInit = (token: string, method = "GET", body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export interface DirectoryDoctorIn {
  id?: string;
  fullName: string;
  specialty: string;
  room?: string;
  week: ([number, number] | null)[];
}
export const directoryApi = {
  get: (t: string) =>
    request<{ staff: { name: string; role: string }; clinic: { name: string; facilityRef: string | null }; doctors: { id: string; name: string; specialty: string; room?: string; week: [number, number][][] | null }[] }>(
      "/api/staff/directory",
      staffInit(t),
    ),
  put: (t: string, doctors: DirectoryDoctorIn[]) => request<{ published: number }>("/api/staff/directory", staffInit(t, "PUT", { doctors })),
};

export const staffApi = {
  me: (t: string) => request<StaffInfo>("/api/staff/me", staffInit(t)),
  schedule: (t: string, doctorId: string, date: string) =>
    request<{ date: string; delayMin: number; rows: ScheduleRow[]; waitlist: { waiting: number; offered: number } }>(`/api/staff/schedule?doctorId=${encodeURIComponent(doctorId)}&date=${date}`, staffInit(t)),
  action: (t: string, id: string, action: string, reason?: string) => request(`/api/staff/appointments/${id}/action`, staffInit(t, "POST", { action, reason })),
  delay: (t: string, doctorId: string, delayMin: number) => request("/api/staff/delay", staffInit(t, "POST", { doctorId, delayMin })),
  walkIn: (t: string, slotId: number, label: string) => request("/api/staff/walk-in", staffInit(t, "POST", { slotId, label })),
  checkIn: (t: string, code: string) =>
    request<{ appointment: { id: string; ticket: string; status: string; patient_label: string; doctor_name: string; starts_at: string } }>("/api/staff/check-in", staffInit(t, "POST", { code })),
  audit: (t: string) => request<{ entries: AuditEntry[] }>("/api/staff/audit", staffInit(t)),
};
