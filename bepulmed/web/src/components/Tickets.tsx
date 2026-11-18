import { useCallback, useEffect, useState } from "react";
import { ApiError, acceptOffer, cancelAppointment, leaveWaitlist, myAppointments, myWaitlist, type Appointment, type WaitlistEntry } from "../lib/api";
import { newIdemKey } from "../lib/format";
import { haptic } from "../lib/telegram";
import { TicketQR } from "./TicketQR";
import { hhmm, longDate } from "../lib/format";
import { t, type Lang } from "../lib/i18n";
import { errorText, specialtyLabel } from "./Booking";
import { loadTickets, saveTickets } from "../lib/ticketCache";

const ACTIVE = new Set(["booked", "checked_in", "in_progress"]);
const STATUS_COLOR: Record<string, string> = {
  booked: "bg-blue-100 text-blue-800",
  checked_in: "bg-amber-100 text-amber-800",
  in_progress: "bg-emerald-100 text-emerald-800",
  done: "bg-gray-200 text-gray-700",
  cancelled: "bg-gray-200 text-gray-500",
  no_show: "bg-red-100 text-red-700",
};

export function Tickets({ lang, visible, refreshKey }: { lang: Lang; visible: boolean; refreshKey: number }) {
  const L = t(lang);
  const [items, setItems] = useState<Appointment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [waits, setWaits] = useState<WaitlistEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  // Время офлайн-копии, если сейчас показываем сохранённые талоны.
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, w] = await Promise.all([myAppointments(), myWaitlist().catch(() => ({ entries: [] as WaitlistEntry[] }))]);
      setItems(a.appointments);
      setWaits(w.entries);
      setErr(null);
      setSavedAt(null);
      saveTickets(a.appointments, w.entries);
    } catch (e) {
      const snap = loadTickets();
      if (snap) {
        setItems(snap.appointments);
        setWaits(snap.waits.filter((x) => x.status === "waiting"));
        setSavedAt(snap.at);
        setErr(null);
      } else setErr(errorText(L, e instanceof ApiError ? e.code : "network"));
    }
  }, [L]);

  // Обновление каждые 15 секунд, а при действующем предложении из листа ожидания — каждые 5.
  const hasOffer = waits.some((w) => w.status === "offered");
  useEffect(() => {
    if (!visible) return;
    void load();
    const id = setInterval(() => void load(), hasOffer ? 5000 : 15000);
    return () => clearInterval(id);
  }, [visible, load, refreshKey, hasOffer]);

  // Обратный отсчёт удержания.
  useEffect(() => {
    if (!visible || !hasOffer) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visible, hasOffer]);

  async function waitAction(fn: () => Promise<unknown>) {
    if (busy) return;
    haptic();
    setBusy(true);
    try {
      await fn();
      setErr(null);
    } catch (e) {
      setErr(errorText(L, e instanceof ApiError ? e.code : "network"));
    } finally {
      setBusy(false);
      void load();
    }
  }

  async function cancel(id: string) {
    try {
      await cancelAppointment(id);
    } catch (e) {
      setErr(errorText(L, e instanceof ApiError ? e.code : "network"));
    }
    setConfirmId(null);
    void load();
  }

  if (!items) return <div className="animate-pulse p-4 text-sm text-[var(--hint)]">{err ?? L.loading}</div>;
  const active = items.filter((a) => ACTIVE.has(a.status));
  const past = items.filter((a) => !ACTIVE.has(a.status));

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3 text-sm">
      <h2 className="text-base font-semibold">{L.ticketsTitle}</h2>
      {err && <p className="text-amber-800">{err}</p>}
      {savedAt && (
        <p className="rounded-xl bg-amber-50 p-2 text-xs text-amber-900" data-testid="tickets-offline">
          📴{" "}
          {lang === "ru"
            ? `Нет связи — показаны сохранённые талоны (обновлено ${new Date(savedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}). QR-код работает без сети; очередь и статус могут быть устаревшими, отмена недоступна.`
            : `Aloqa yo‘q — saqlangan talonlar ko‘rsatilmoqda (yangilangan ${new Date(savedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}). QR-kod internetsiz ishlaydi; navbat va holat eskirgan bo‘lishi mumkin, bekor qilib bo‘lmaydi.`}
        </p>
      )}
      {waits.map((w) => {
        // Не больше 10 минут: часы телефона и сервера могут расходиться на секунды.
        const left = w.offer ? Math.min(600, Math.max(0, Math.floor((Date.parse(w.offer.expires_at) - now) / 1000))) : 0;
        const where = `${w.doctor_name} · ${specialtyLabel(L, w.specialty)} · ${longDate(w.local_date, lang)}`;
        if (w.status === "offered" && w.offer)
          return (
            <div key={w.id} className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-3 text-emerald-950" data-testid="wait-offer">
              <div className="text-base font-semibold">🔔 {L.waitOffer}</div>
              <div className="mt-1">{where}</div>
              <div className="text-2xl font-bold tabular-nums">{hhmm(w.offer.starts_at)}</div>
              <div className="text-xs">
                {L.waitHeldUntil} {hhmm(w.offer.expires_at)} · {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  disabled={busy || left === 0}
                  onClick={() => waitAction(() => acceptOffer(w.id, newIdemKey()))}
                  className="flex-1 rounded-xl bg-emerald-600 py-2 font-medium text-white disabled:opacity-40"
                >
                  {L.waitAccept}
                </button>
                <button disabled={busy} onClick={() => waitAction(() => leaveWaitlist(w.id))} className="rounded-xl bg-black/10 px-3 py-2">
                  {L.waitDecline}
                </button>
              </div>
            </div>
          );
        if (w.status === "waiting")
          return (
            <div key={w.id} className="rounded-2xl bg-[var(--card)] p-3" data-testid="wait-card">
              <div className="flex items-center justify-between">
                <span className="font-semibold">⏳ {L.waitTitle}</span>
                <span className="text-xs">
                  {L.waitPosition}: <b className="text-base">{w.position}</b>
                </span>
              </div>
              <div className="mt-1">{where}</div>
              <div className="text-xs text-[var(--hint)]">{L.waitJoinNote}</div>
              <button disabled={busy} onClick={() => waitAction(() => leaveWaitlist(w.id))} className="mt-2 text-xs text-red-600 underline">
                {L.waitLeave}
              </button>
            </div>
          );
        const label = w.status === "booked" ? L.waitBooked : w.status === "expired" ? L.waitExpired : L.waitCancelled;
        return (
          <div key={w.id} className="rounded-2xl bg-[var(--card)] p-2 text-xs opacity-60">
            {label} · {where}
          </div>
        );
      })}
      {active.length === 0 && <p className="text-[var(--hint)]">{L.noTickets}</p>}
      {[...active, ...past].map((a) => {
        const isActive = ACTIVE.has(a.status);
        const statusKey = `st_${a.status}` as keyof typeof L;
        return (
          <div key={a.id} className={`rounded-2xl bg-[var(--card)] p-3 ${isActive ? "" : "opacity-60"}`} data-testid="ticket-card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-3xl font-bold tracking-wider">{a.ticket}</div>
                <div className="text-xs text-[var(--hint)]">
                  {longDate(a.local_date, lang)} · {hhmm(a.starts_at)}
                </div>
              </div>
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[a.status]}`}>{L[statusKey] as string}</span>
            </div>
            <div className="mt-1">
              {a.doctor_name} · {specialtyLabel(L, a.specialty)}
              {a.room ? ` · ${L.room} ${a.room}` : ""}
            </div>
            <div className="text-xs text-[var(--hint)]">{lang === "uz" ? a.clinic_name_uz : a.clinic_name_ru}</div>

            {a.status === "booked" && <TicketQR appointmentId={a.id} hint={L.qrShow} codeLabel={L.qrCode} />}

            {isActive && a.called_at && a.status === "checked_in" && (
              <div className="mt-2 animate-pulse rounded-xl bg-emerald-600 p-2 text-center font-semibold text-white">
                🔔 {L.called} {a.room ?? ""}
              </div>
            )}

            {!savedAt && isActive && a.queue && a.status !== "in_progress" && !a.called_at && (
              <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-[var(--bg)] p-2 text-center">
                <div>
                  <div className="text-[10px] text-[var(--hint)]">{L.ahead}</div>
                  <div className="text-lg font-semibold">
                    {a.queue.ahead} <span className="text-xs font-normal">{L.people}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--hint)]">{L.expected}</div>
                  <div className="text-lg font-semibold">~{hhmm(a.queue.expectedStart)}</div>
                </div>
                {a.queue.delayMin > 0 && (
                  <div className="col-span-2 text-xs text-amber-700">
                    ⏳ {L.delay} {a.queue.delayMin} {L.minutes}
                  </div>
                )}
                <div className="col-span-2 text-[10px] text-[var(--hint)]">{L.estimateNote}</div>
              </div>
            )}

            {!savedAt && (a.status === "booked" || a.status === "checked_in") &&
              (confirmId === a.id ? (
                <div className="mt-2 flex items-center gap-2">
                  <span className="flex-1">{L.cancelConfirm}</span>
                  <button onClick={() => cancel(a.id)} className="rounded-lg bg-red-600 px-3 py-1 text-white">
                    {L.yes}
                  </button>
                  <button onClick={() => setConfirmId(null)} className="rounded-lg bg-black/10 px-3 py-1">
                    {L.no}
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmId(a.id)} className="mt-2 text-xs text-red-600 underline">
                  {L.cancel}
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
