import { useEffect, useState } from "react";
import { SPECIALTIES, type Specialty } from "../../../worker/src/doctors";
import { ApiError, directoryApi, type DirectoryDoctorIn } from "../lib/api";

// Кабинет регистратуры: публикация врачей и часов приёма в открытом справочнике (#/admin/doctors).
// Данных пациентов здесь нет, поэтому работает и когда запись к врачу выключена.

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromHM = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  return m ? +m[1] * 60 + +m[2] : null;
};

interface Row {
  id?: string;
  fullName: string;
  specialty: Specialty;
  room: string;
  days: { on: boolean; from: string; to: string }[];
}

const emptyRow = (): Row => ({ fullName: "", specialty: "family", room: "", days: DAYS.map((_, i) => ({ on: i < 6, from: "08:00", to: "17:00" })) });

export function DoctorsEditor() {
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem("bm_staff") ?? "";
    } catch {
      return "";
    }
  });
  const [input, setInput] = useState("");
  const [clinic, setClinic] = useState<string>("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    directoryApi
      .get(token)
      .then((r) => {
        setClinic(`${r.clinic.name}${r.clinic.facilityRef ? "" : " — не связана со справочником (facility_ref)"} · ${r.staff.name}`);
        setRows(
          r.doctors.map((d) => ({
            id: d.id,
            fullName: d.name,
            specialty: (d.specialty in SPECIALTIES ? d.specialty : "other") as Specialty,
            room: d.room ?? "",
            days: DAYS.map((_, i) => {
              const x = d.week?.[i]?.[0];
              return x ? { on: true, from: toHM(x[0]), to: toHM(x[1]) } : { on: false, from: "08:00", to: "17:00" };
            }),
          })),
        );
        try {
          sessionStorage.setItem("bm_staff", token);
        } catch {
          /* ignore */
        }
      })
      .catch((e) => {
        setMsg({ ok: false, text: e instanceof ApiError && e.code === "unauthorized" ? "Неверный ключ сотрудника." : "Сервер недоступен." });
        setToken("");
      });
  }, [token]);

  const upd = (i: number, f: (r: Row) => Row) => setRows((rs) => rs!.map((r, k) => (k === i ? f(r) : r)));

  async function save() {
    if (!rows) return;
    const doctors: DirectoryDoctorIn[] = [];
    for (const r of rows) {
      const week: ([number, number] | null)[] = [];
      for (const d of r.days) {
        if (!d.on) {
          week.push(null);
          continue;
        }
        const a = fromHM(d.from);
        const b = fromHM(d.to);
        if (a == null || b == null || b <= a) return setMsg({ ok: false, text: `Проверьте часы у «${r.fullName || "врача"}» (формат 08:00, конец позже начала).` });
        week.push([a, b]);
      }
      doctors.push({ id: r.id, fullName: r.fullName, specialty: r.specialty, room: r.room || undefined, week });
    }
    setBusy(true);
    try {
      const res = await directoryApi.put(token, doctors);
      setMsg({ ok: true, text: `Опубликовано врачей: ${res.published}. Пациенты увидят расписание на странице поликлиники.` });
    } catch (e) {
      setMsg({ ok: false, text: `Не сохранено: ${e instanceof ApiError ? e.code : "network"}` });
    } finally {
      setBusy(false);
    }
  }

  if (!token)
    return (
      <form
        className="mx-auto max-w-md space-y-3 p-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          setToken(input.trim());
        }}
        data-testid="doctors-editor-login"
      >
        <h1 className="text-lg font-semibold">Расписание врачей — регистратура</h1>
        <p className="text-xs text-[var(--hint)]">Введите ключ сотрудника (роль «регистратор» или «администратор»).</p>
        <input value={input} onChange={(e) => setInput(e.target.value)} className="w-full rounded-xl bg-[var(--card)] px-3 py-2" placeholder="Ключ сотрудника" autoComplete="off" />
        <button className="w-full rounded-xl bg-[var(--btn)] py-2 font-medium text-[var(--btn-text)]">Войти</button>
        {msg && <p className="text-red-700">{msg.text}</p>}
      </form>
    );

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-3 text-sm" data-testid="doctors-editor">
      <h1 className="text-lg font-semibold">Врачи и часы приёма</h1>
      <p className="text-xs text-[var(--hint)]">{clinic}</p>
      <p className="rounded-xl bg-sky-50 p-2 text-xs text-sky-900">
        Публикуется открыто: ФИО врача, специальность, кабинет и часы приёма. Данных пациентов здесь нет. Каждое сохранение записывается в журнал.
      </p>
      {rows?.map((r, i) => (
        <div key={r.id ?? `new${i}`} className="space-y-2 rounded-2xl bg-[var(--card)] p-3" data-testid="editor-row">
          <div className="flex gap-2">
            <input value={r.fullName} onChange={(e) => upd(i, (x) => ({ ...x, fullName: e.target.value }))} placeholder="ФИО врача" className="min-w-0 flex-1 rounded-lg bg-white px-2 py-1" />
            <input value={r.room} onChange={(e) => upd(i, (x) => ({ ...x, room: e.target.value }))} placeholder="Каб." className="w-16 rounded-lg bg-white px-2 py-1" />
          </div>
          <select value={r.specialty} onChange={(e) => upd(i, (x) => ({ ...x, specialty: e.target.value as Specialty }))} className="w-full rounded-lg bg-white px-2 py-1">
            {(Object.keys(SPECIALTIES) as Specialty[]).map((k) => (
              <option key={k} value={k}>
                {SPECIALTIES[k].ru}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-1 gap-1">
            {r.days.map((d, k) => (
              <label key={k} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={d.on} onChange={(e) => upd(i, (x) => ({ ...x, days: x.days.map((y, j) => (j === k ? { ...y, on: e.target.checked } : y)) }))} />
                <span className="w-6">{DAYS[k]}</span>
                {d.on ? (
                  <>
                    <input value={d.from} onChange={(e) => upd(i, (x) => ({ ...x, days: x.days.map((y, j) => (j === k ? { ...y, from: e.target.value } : y)) }))} className="w-16 rounded bg-white px-1" aria-label={`${DAYS[k]} с`} />–
                    <input value={d.to} onChange={(e) => upd(i, (x) => ({ ...x, days: x.days.map((y, j) => (j === k ? { ...y, to: e.target.value } : y)) }))} className="w-16 rounded bg-white px-1" aria-label={`${DAYS[k]} до`} />
                  </>
                ) : (
                  <span className="text-[var(--hint)]">не принимает</span>
                )}
              </label>
            ))}
          </div>
          <button onClick={() => setRows((rs) => rs!.filter((_, k) => k !== i))} className="text-xs text-red-700 underline">
            Убрать из справочника
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <button onClick={() => setRows((rs) => [...(rs ?? []), emptyRow()])} className="flex-1 rounded-xl border border-black/15 py-2" data-testid="editor-add">
          + Врач
        </button>
        <button onClick={() => void save()} disabled={busy || !rows?.length} className="flex-1 rounded-xl bg-[var(--btn)] py-2 font-medium text-[var(--btn-text)] disabled:opacity-50" data-testid="editor-save">
          {busy ? "…" : "Опубликовать"}
        </button>
      </div>
      {msg && (
        <p className={msg.ok ? "text-emerald-700" : "text-red-700"} data-testid="editor-msg">
          {msg.text}
        </p>
      )}
    </div>
  );
}
