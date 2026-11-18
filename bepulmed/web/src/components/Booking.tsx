import { useEffect, useMemo, useState } from "react";
import { ApiError, createAppointment, getClinics, joinWaitlist, getSlots, type Appointment, type Clinic, type Doctor, type Slot, type Specialty } from "../lib/api";
import { dayLabel, hhmm, longDate, newIdemKey, nextDays, todayTashkent } from "../lib/format";
import { t, type Lang } from "../lib/i18n";
import { haptic } from "../lib/telegram";

type Step = "pick" | "confirm" | "done";

export function errorText(L: ReturnType<typeof t>, code: string): string {
  const k = `err_${code}` as keyof typeof L;
  return (L[k] as string | undefined) ?? (code === "network" ? L.errNetwork : L.err_generic);
}

export function specialtyLabel(L: ReturnType<typeof t>, sp: string): string {
  const k = `spec_${sp}` as keyof typeof L;
  return (L[k] as string | undefined) ?? sp;
}

export function Booking({
  lang,
  visible,
  specialty,
  onSpecialty,
  onBooked,
}: {
  lang: Lang;
  visible: boolean;
  specialty: Specialty | null;
  onSpecialty: (s: Specialty | null) => void;
  onBooked: () => void;
}) {
  const L = t(lang);
  const [clinics, setClinics] = useState<Clinic[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const days = useMemo(() => nextDays(7), []);
  const [date, setDate] = useState(days[0]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [step, setStep] = useState<Step>("pick");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [alts, setAlts] = useState<Slot[]>([]);
  const [result, setResult] = useState<Appointment | null>(null);
  const [idemKey, setIdemKey] = useState(newIdemKey);
  const [waitMsg, setWaitMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || clinics) return;
    getClinics()
      .then((r) => setClinics(r.clinics))
      .catch((e) => setLoadErr(e instanceof ApiError ? e.code : "network"));
  }, [visible, clinics]);

  const doctors = useMemo(() => (clinics ?? []).flatMap((c) => c.doctors.map((d) => ({ ...d, clinic: c }))), [clinics]);
  const shown = doctors.filter((d) => !specialty || d.specialty === specialty);

  async function loadSlots(d: Doctor, day: string) {
    setSlots(null);
    setErr(null);
    setWaitMsg(null);
    try {
      setSlots((await getSlots(d.id, day)).slots);
    } catch (e) {
      setErr(errorText(L, e instanceof ApiError ? e.code : "network"));
      setSlots([]);
    }
  }

  useEffect(() => {
    if (doctor && step === "pick") void loadSlots(doctor, date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctor, date, step]);

  async function joinWait() {
    if (!doctor || busy) return;
    haptic();
    setBusy(true);
    setErr(null);
    try {
      const r = await joinWaitlist(doctor.id, date);
      setWaitMsg(`${L.waitJoined} ${r.entry.position ?? 1}`);
    } catch (e) {
      setErr(errorText(L, e instanceof ApiError ? e.code : "network"));
    } finally {
      setBusy(false);
    }
  }

  const clinicOf = (d: Doctor) => clinics?.find((c) => c.id === d.clinic_id);

  async function confirm() {
    if (!slot || busy) return;
    haptic();
    setBusy(true);
    setErr(null);
    setAlts([]);
    try {
      const r = await createAppointment(slot.id, idemKey);
      setResult(r.appointment);
      setStep("done");
      setIdemKey(newIdemKey());
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "network";
      setErr(errorText(L, code));
      if (code === "slot_taken" && e instanceof ApiError) setAlts(((e.extra.alternatives as Omit<Slot, "available">[]) ?? []).map((a) => ({ ...a, available: true })));
      if (code !== "network") setIdemKey(newIdemKey()); // сетевой сбой — повторяем с тем же ключом
      // Слоты перезагрузятся при возврате к выбору (эффект по step) — здесь не трогаем, чтобы не стереть сообщение.
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("pick");
    setSlot(null);
    setResult(null);
    setErr(null);
    setAlts([]);
  }

  if (loadErr) return <div className="p-4 text-sm">{errorText(L, loadErr)}</div>;
  if (!clinics) return <div className="animate-pulse p-4 text-sm text-[var(--hint)]">{L.loading}</div>;

  if (step === "done" && result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-5xl">✅</div>
        <div className="text-lg font-semibold">{L.booked}</div>
        <div className="rounded-2xl bg-[var(--card)] px-6 py-4">
          <div className="text-xs text-[var(--hint)]">{L.ticket}</div>
          <div className="text-4xl font-bold tracking-wider" data-testid="ticket">
            {result.ticket}
          </div>
          <div className="mt-1 text-sm">
            {longDate(result.local_date, lang)} · {hhmm(result.starts_at)}
          </div>
          <div className="text-sm">{result.doctor_name}</div>
          {result.room && (
            <div className="text-xs text-[var(--hint)]">
              {L.room} {result.room}
            </div>
          )}
        </div>
        <button onClick={onBooked} className="rounded-xl bg-[var(--btn)] px-6 py-2.5 font-medium text-[var(--btn-text)]">
          {L.toTickets}
        </button>
        <button onClick={reset} className="text-sm text-[var(--link)]">
          {L.back}
        </button>
      </div>
    );
  }

  if (step === "confirm" && slot && doctor) {
    const c = clinicOf(doctor);
    return (
      <div className="space-y-3 p-4 text-sm">
        <h2 className="text-base font-semibold">{L.confirmTitle}</h2>
        <dl className="space-y-1.5 rounded-2xl bg-[var(--card)] p-3">
          <Row k={L.clinic} v={c ? (lang === "uz" ? c.name_uz : c.name_ru) : ""} />
          <Row k={L.doctor} v={`${doctor.full_name} · ${specialtyLabel(L, doctor.specialty)}`} />
          <Row k={L.date} v={longDate(date, lang)} />
          <Row k={L.time} v={`${hhmm(slot.starts_at)}–${hhmm(slot.ends_at)}`} />
          {doctor.room && <Row k={L.room} v={doctor.room} />}
        </dl>
        {err && <p className="rounded-xl bg-amber-50 p-2 text-amber-900">{err}</p>}
        {alts.length > 0 && (
          <div>
            <div className="mb-1 text-xs text-[var(--hint)]">{L.alternatives}</div>
            <div className="flex flex-wrap gap-2">
              {alts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    // Альтернатива может быть на другой день — дату берём из самого слота.
                    setDate(todayTashkent(new Date(a.starts_at)));
                    setSlot(a);
                    setErr(null);
                    setAlts([]);
                  }}
                  className="rounded-lg border border-[var(--btn)] px-2 py-1 text-xs text-[var(--link)]"
                >
                  {longDate(todayTashkent(new Date(a.starts_at)), lang)} · {hhmm(a.starts_at)}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="text-[11px] text-[var(--hint)]">{L.emergencyNoQueue}</p>
        <button onClick={confirm} disabled={busy || alts.length > 0} className="w-full rounded-xl bg-[var(--btn)] py-3 font-medium text-[var(--btn-text)] disabled:opacity-40">
          {busy ? "…" : L.confirmBtn}
        </button>
        <button onClick={() => setStep("pick")} className="w-full py-2 text-[var(--link)]">
          {L.back}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3 text-sm">
      <h2 className="text-base font-semibold">{L.bookTitle}</h2>
      <p className="rounded-xl border border-dashed border-purple-400 p-2 text-xs text-purple-900">{L.bookNote}</p>

      <div className="flex gap-1.5 overflow-x-auto">
        {([null, "therapy", "cardiology"] as const).map((sp) => (
          <button
            key={sp ?? "all"}
            onClick={() => {
              onSpecialty(sp);
              setDoctor(null);
              setSlot(null);
            }}
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${specialty === sp ? "bg-[var(--btn)] text-[var(--btn-text)]" : "bg-[var(--card)]"}`}
          >
            {sp ? specialtyLabel(L, sp) : L.allSpecialties}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {shown.map((d) => (
          <button
            key={d.id}
            onClick={() => {
              setDoctor(d);
              setSlot(null);
            }}
            className={`w-full rounded-2xl bg-[var(--card)] p-3 text-left ${doctor?.id === d.id ? "ring-2 ring-[var(--btn)]" : ""}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">{d.full_name}</span>
              {d.clinic.is_demo && <span className="rounded bg-purple-600 px-1.5 text-[10px] font-bold text-white">{L.demoBadge}</span>}
            </div>
            <div className="text-xs text-[var(--hint)]">
              {specialtyLabel(L, d.specialty)} · {lang === "uz" ? d.clinic.name_uz : d.clinic.name_ru}
              {d.room ? ` · ${L.room} ${d.room}` : ""}
            </div>
          </button>
        ))}
      </div>

      {doctor && (
        <>
          <div className="text-xs font-semibold text-[var(--hint)]">{L.pickDate}</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {days.map((d) => {
              const l = dayLabel(d, lang);
              return (
                <button
                  key={d}
                  onClick={() => {
                    setDate(d);
                    setSlot(null);
                  }}
                  className={`flex w-12 shrink-0 flex-col items-center rounded-xl py-1.5 text-xs ${date === d ? "bg-[var(--btn)] text-[var(--btn-text)]" : "bg-[var(--card)]"}`}
                >
                  <span>{l.weekday}</span>
                  <span className="font-semibold">{l.day}</span>
                </button>
              );
            })}
          </div>
          <div className="text-xs font-semibold text-[var(--hint)]">{L.pickTime}</div>
          {err && <p className="text-amber-800">{err}</p>}
          {!slots && <div className="animate-pulse text-[var(--hint)]">{L.loading}</div>}
          {slots && slots.filter((s) => s.available).length === 0 && <div className="text-[var(--hint)]">{L.noSlots}</div>}
          {slots && slots.length > 0 && slots.every((s) => !s.available) && slots.some((s) => Date.parse(s.starts_at) > Date.now()) && (
            <div className="space-y-2 rounded-2xl bg-[var(--card)] p-3" data-testid="waitlist-box">
              {waitMsg ? (
                <>
                  <p className="font-medium text-emerald-700">✅ {waitMsg}</p>
                  <button onClick={onBooked} className="text-xs text-[var(--link)] underline">
                    {L.toTickets}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-[var(--hint)]">{L.waitJoinNote}</p>
                  <button onClick={joinWait} disabled={busy} className="w-full rounded-xl border border-[var(--btn)] py-2 font-medium text-[var(--link)] disabled:opacity-40">
                    ⏳ {L.waitJoin}
                  </button>
                </>
              )}
            </div>
          )}
          <div className="grid grid-cols-4 gap-1.5" data-testid="slots">
            {slots?.map((s) => (
              <button
                key={s.id}
                disabled={!s.available}
                onClick={() => setSlot(s)}
                className={`rounded-lg py-1.5 text-xs tabular-nums ${
                  !s.available ? "bg-black/5 text-[var(--hint)] line-through" : slot?.id === s.id ? "bg-[var(--btn)] text-[var(--btn-text)]" : "border border-[var(--btn)] text-[var(--link)]"
                }`}
              >
                {hhmm(s.starts_at)}
              </button>
            ))}
          </div>
          <button
            disabled={!slot}
            onClick={() => {
              setErr(null);
              setStep("confirm");
            }}
            className="sticky bottom-0 w-full rounded-xl bg-[var(--btn)] py-3 font-medium text-[var(--btn-text)] disabled:opacity-40"
          >
            {L.bookThis}
            {slot ? ` · ${hhmm(slot.starts_at)}` : ""}
          </button>
        </>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--hint)]">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}
