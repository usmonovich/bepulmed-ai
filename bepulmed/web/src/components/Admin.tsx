import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ApiError, staffApi, type AuditEntry, type ScheduleRow, type StaffInfo } from "../lib/api";
import { hhmm, longDate, nextDays } from "../lib/format";
// Сканер (jsQR) грузится только когда регистратор его открыл — пациентам не нужен.
const QRScanner = lazy(() => import("./QRScanner").then((m) => ({ default: m.QRScanner })));

// Кабинет клиники (регистратура / врач / администратор). Открывается по адресу …/#/admin.
// Интерфейс на русском: рассчитан на сотрудников, работает и в обычном браузере на компьютере.

const ST: Record<string, { label: string; cls: string }> = {
  booked: { label: "Записан", cls: "bg-blue-100 text-blue-800" },
  checked_in: { label: "Пришёл", cls: "bg-amber-100 text-amber-800" },
  in_progress: { label: "На приёме", cls: "bg-emerald-100 text-emerald-800" },
  done: { label: "Завершён", cls: "bg-gray-200 text-gray-700" },
  no_show: { label: "Неявка", cls: "bg-red-100 text-red-700" },
};

const ACTIONS: { action: string; label: string; from: string[]; roles: string[]; danger?: boolean }[] = [
  { action: "check_in", label: "Пришёл", from: ["booked"], roles: ["registrar", "admin"] },
  { action: "call", label: "Вызвать", from: ["checked_in"], roles: ["registrar", "doctor", "admin"] },
  { action: "start", label: "Начать приём", from: ["checked_in"], roles: ["doctor", "admin"] },
  { action: "finish", label: "Завершить", from: ["in_progress"], roles: ["doctor", "admin"] },
  { action: "no_show", label: "Неявка", from: ["booked", "checked_in"], roles: ["registrar", "admin"], danger: true },
  { action: "cancel", label: "Отменить", from: ["booked", "checked_in"], roles: ["registrar", "admin"], danger: true },
];

const ERR: Record<string, string> = {
  unauthorized: "Неверный или отключённый токен.",
  forbidden: "Недостаточно прав для этого действия.",
  invalid_transition: "Действие недоступно в текущем статусе.",
  conflict_retry: "Запись только что изменил другой сотрудник. Обновлено.",
  reason_required: "Укажите причину (не короче 3 символов).",
  too_early_for_no_show: "Неявку можно отметить только после начала времени приёма.",
  slot_taken: "Слот уже занят.",
  label_required: "Укажите имя пациента.",
  invalid_delay: "Задержка — целое число минут от 0 до 600.",
  network: "Нет связи с сервером.",
  invalid_code: "Это не QR-код талона BepulMed.",
  not_found: "Запись не найдена в вашей клинике.",
  not_today: "Эта запись не на сегодня.",
  ambiguous_code: "Код совпал с несколькими записями — отсканируйте QR.",
};
const errMsg = (e: unknown) => ERR[e instanceof ApiError ? e.code : "network"] ?? `Ошибка: ${e instanceof ApiError ? e.code : "network"}`;

function readToken(): string {
  try {
    return sessionStorage.getItem("bm_staff") ?? "";
  } catch {
    return "";
  }
}

export function Admin() {
  const [token, setToken] = useState(readToken);
  const [me, setMe] = useState<StaffInfo | null>(null);
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (!token) return;
    staffApi
      .me(token)
      .then((r) => {
        setMe(r);
        setLoginErr(null);
      })
      .catch((e) => {
        setLoginErr(errMsg(e));
        setToken("");
        try {
          sessionStorage.removeItem("bm_staff");
        } catch {
          /* нет хранилища */
        }
      });
  }, [token]);

  function login(e: React.FormEvent) {
    e.preventDefault();
    const v = input.trim();
    if (!v) return;
    // Токен — только латиница, цифры, «-» и «_». Иначе браузер не сможет отправить заголовок.
    if (!/^[A-Za-z0-9_-]{24,128}$/.test(v)) {
      setLoginErr("Неверный формат токена.");
      return;
    }
    try {
      sessionStorage.setItem("bm_staff", v);
    } catch {
      /* нет хранилища */
    }
    setInput("");
    setToken(v);
  }

  function logout() {
    try {
      sessionStorage.removeItem("bm_staff");
    } catch {
      /* нет хранилища */
    }
    setToken("");
    setMe(null);
  }

  if (!token || !me) {
    return (
      <div className="mx-auto flex h-full max-w-sm flex-col justify-center gap-3 p-6">
        <h1 className="text-xl font-bold">
          Bepul<span className="text-[var(--link)]">Med</span> — кабинет клиники
        </h1>
        <p className="text-sm text-[var(--hint)]">Вход по персональному токену сотрудника. Токен выдаёт администратор платформы.</p>
        <form onSubmit={login} className="flex flex-col gap-2">
          <input
            type="password"
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Токен сотрудника"
            className="rounded-xl bg-[var(--card)] px-3 py-2 outline-none"
            aria-label="Токен сотрудника"
          />
          <button className="rounded-xl bg-[var(--btn)] py-2 font-medium text-[var(--btn-text)]">Войти</button>
        </form>
        {token && !loginErr && <p className="text-sm text-[var(--hint)]">Проверка…</p>}
        {loginErr && <p className="text-sm text-red-600">{loginErr}</p>}
        <a href="#/" className="text-center text-sm text-[var(--link)]">
          ← К приложению пациента
        </a>
      </div>
    );
  }
  return <Dashboard token={token} me={me} onLogout={logout} />;
}

function Dashboard({ token, me, onLogout }: { token: string; me: StaffInfo; onLogout: () => void }) {
  const role = me.staff.role;
  const doctors = (me.clinic?.doctors ?? []).filter((d) => role !== "doctor" || d.id === me.staff.doctor_id);
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? "");
  const days = nextDays(7);
  const [date, setDate] = useState(days[0]);
  const [rows, setRows] = useState<ScheduleRow[] | null>(null);
  const [delay, setDelay] = useState(0);
  const [delayInput, setDelayInput] = useState("0");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [tab, setTab] = useState<"schedule" | "audit">("schedule");
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [walkFor, setWalkFor] = useState<number | null>(null);
  const [walkName, setWalkName] = useState("");
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false);
  const [wl, setWl] = useState({ waiting: 0, offered: 0 });

  const load = useCallback(async () => {
    if (!doctorId) return;
    try {
      const r = await staffApi.schedule(token, doctorId, date);
      setRows(r.rows);
      setDelay(r.delayMin);
      setWl(r.waitlist ?? { waiting: 0, offered: 0 });
    } catch (e) {
      setMsg({ text: errMsg(e), ok: false });
    }
  }, [token, doctorId, date]);

  // Обновление каждые 5 секунд: новые записи пациентов появляются без перезагрузки.
  useEffect(() => {
    setRows(null);
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => setDelayInput(String(delay)), [delay]);

  useEffect(() => {
    if (tab !== "audit") return;
    staffApi
      .audit(token)
      .then((r) => setAudit(r.entries))
      .catch((e) => setMsg({ text: errMsg(e), ok: false }));
  }, [tab, token, rows]);

  async function run(fn: () => Promise<unknown>, okText: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (okText) setMsg({ text: okText, ok: true });
    } catch (e) {
      setMsg({ text: errMsg(e), ok: false });
    } finally {
      setBusy(false);
      void load();
    }
  }

  const onScan = useCallback(
    (code: string) => {
      void run(async () => {
        const r = await staffApi.checkIn(token, code);
        setMsg({ text: `✅ ${r.appointment.ticket} · ${r.appointment.patient_label} · ${hhmm(r.appointment.starts_at)} — отмечен «Пришёл».`, ok: true });
      }, "");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token],
  );

  const freeCount = rows?.filter((r) => !r.appointment_id && Date.parse(r.starts_at) > Date.now()).length ?? 0;
  const activeCount = rows?.filter((r) => r.status && ["booked", "checked_in", "in_progress"].includes(r.status)).length ?? 0;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-black/10 px-3 py-2">
        <div>
          <div className="font-bold">
            {me.clinic?.name_ru}
            {me.clinic?.is_demo && <span className="ml-2 rounded bg-purple-600 px-1.5 text-[10px] text-white">ДЕМО</span>}
          </div>
          <div className="text-xs text-[var(--hint)]">
            {me.staff.name} · {role === "admin" ? "администратор" : role === "doctor" ? "врач" : "регистратор"}
          </div>
        </div>
        <div className="flex gap-2 text-sm">
          {(role === "registrar" || role === "admin") && (
            <button onClick={() => setScan(true)} className="rounded-lg bg-[var(--btn)] px-3 py-1 text-[var(--btn-text)]" data-testid="scan-btn">
              📷 QR
            </button>
          )}
          {role === "admin" && (
            <button onClick={() => setTab(tab === "audit" ? "schedule" : "audit")} className="rounded-lg bg-[var(--card)] px-3 py-1">
              {tab === "audit" ? "Расписание" : "Журнал"}
            </button>
          )}
          <button onClick={onLogout} className="rounded-lg bg-[var(--card)] px-3 py-1">
            Выйти
          </button>
        </div>
      </header>

      {scan && (
        <Suspense fallback={null}>
          <QRScanner busy={busy} onCode={onScan} onClose={() => setScan(false)} />
        </Suspense>
      )}
      {msg && (
        <div className={`px-3 py-1.5 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`} role="status">
          {msg.text}
        </div>
      )}

      {tab === "audit" ? (
        <div className="flex-1 overflow-y-auto p-3">
          <h2 className="mb-2 font-semibold">Журнал действий (только чтение)</h2>
          {!audit && <p className="text-sm text-[var(--hint)]">Загрузка…</p>}
          <table className="w-full text-xs">
            <thead className="text-left text-[var(--hint)]">
              <tr>
                <th className="py-1">Время</th>
                <th>Сотрудник</th>
                <th>Действие</th>
                <th>Статус</th>
                <th>Причина</th>
              </tr>
            </thead>
            <tbody>
              {audit?.map((a) => (
                <tr key={a.id} className="border-t border-black/5" data-testid="audit-row">
                  <td className="py-1 whitespace-nowrap">
                    {new Date(a.at).toLocaleDateString("ru-RU", { timeZone: "Asia/Tashkent" })} {hhmm(a.at)}
                  </td>
                  <td>
                    {a.staff_name} <span className="text-[var(--hint)]">({a.staff_role})</span>
                  </td>
                  <td>{a.action}</td>
                  <td>
                    {a.before_status ?? "—"} → {a.after_status ?? "—"}
                  </td>
                  <td>{a.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2 p-3 text-sm">
            <label className="flex flex-col">
              <span className="text-xs text-[var(--hint)]">Врач</span>
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="rounded-lg bg-[var(--card)] px-2 py-1.5">
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-1">
              {days.map((d) => (
                <button key={d} onClick={() => setDate(d)} className={`rounded-lg px-2 py-1.5 text-xs ${date === d ? "bg-[var(--btn)] text-[var(--btn-text)]" : "bg-[var(--card)]"}`}>
                  {longDate(d, "ru")}
                </button>
              ))}
            </div>
            <form
              className="flex items-end gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => staffApi.delay(token, doctorId, Number(delayInput)), "Задержка сохранена, пациенты увидят новый прогноз.");
              }}
            >
              <label className="flex flex-col">
                <span className="text-xs text-[var(--hint)]">Задержка сегодня, мин</span>
                <input value={delayInput} onChange={(e) => setDelayInput(e.target.value)} inputMode="numeric" className="w-20 rounded-lg bg-[var(--card)] px-2 py-1.5" />
              </label>
              <button className="rounded-lg bg-[var(--card)] px-2 py-1.5">OK</button>
            </form>
          </div>
          <div className="px-3 pb-1 text-xs text-[var(--hint)]">
            Активных записей: {activeCount} · свободных слотов: {freeCount}
            {(wl.waiting > 0 || wl.offered > 0) && (
              <span className="text-amber-700" data-testid="wl-stats">
                {" "}
                · лист ожидания: {wl.waiting}
                {wl.offered > 0 ? ` (+${wl.offered} с предложением)` : ""}
              </span>
            )}{" "}
            · обновление каждые 5 с
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-6">
            {!rows && <p className="text-sm text-[var(--hint)]">Загрузка…</p>}
            <table className="w-full text-sm">
              <tbody>
                {rows?.map((r) => {
                  const key = `${r.slot_id}:${r.appointment_id ?? "free"}`;
                  const past = Date.parse(r.starts_at) <= Date.now();
                  return (
                    <tr key={key} className="border-t border-black/5 align-top" data-testid={r.appointment_id ? "appt-row" : "free-row"}>
                      <td className="w-14 py-2 tabular-nums">{hhmm(r.starts_at)}</td>
                      {r.appointment_id ? (
                        <td className="py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <b>{r.ticket}</b>
                            <span>{r.patient_label}</span>
                            <span className={`rounded px-1.5 text-[11px] ${ST[r.status!]?.cls ?? ""}`}>{ST[r.status!]?.label ?? r.status}</span>
                            {r.channel === "registry" && <span className="text-[10px] text-[var(--hint)]">регистратура</span>}
                            {r.called_at && r.status === "checked_in" && <span className="text-[10px] text-emerald-700">вызван {hhmm(r.called_at)}</span>}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {ACTIONS.filter((a) => a.from.includes(r.status!) && a.roles.includes(role)).map((a) => (
                              <button
                                key={a.action}
                                disabled={busy}
                                onClick={() => {
                                  if (a.action === "cancel") {
                                    setReasonFor(r.appointment_id);
                                    setReason("");
                                    return;
                                  }
                                  void run(() => staffApi.action(token, r.appointment_id!, a.action), `${r.ticket}: ${a.label.toLowerCase()} — сохранено в журнал.`);
                                }}
                                className={`rounded-lg px-2 py-1 text-xs ${a.danger ? "bg-red-50 text-red-700" : "bg-[var(--btn)] text-[var(--btn-text)]"} disabled:opacity-40`}
                              >
                                {a.label}
                              </button>
                            ))}
                          </div>
                          {reasonFor === r.appointment_id && (
                            <form
                              className="mt-1 flex gap-1"
                              onSubmit={(e) => {
                                e.preventDefault();
                                setReasonFor(null);
                                void run(() => staffApi.action(token, r.appointment_id!, "cancel", reason), `${r.ticket}: отменено, причина записана в журнал.`);
                              }}
                            >
                              <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина отмены (обязательно)" className="flex-1 rounded-lg bg-[var(--card)] px-2 py-1 text-xs" />
                              <button className="rounded-lg bg-red-600 px-2 text-xs text-white">Отменить запись</button>
                              <button type="button" onClick={() => setReasonFor(null)} className="px-2 text-xs">
                                ✕
                              </button>
                            </form>
                          )}
                        </td>
                      ) : (
                        <td className="py-2 text-[var(--hint)]">
                          {past ? (
                            "—"
                          ) : r.held ? (
                            <span className="text-amber-700">⏳ удержано для пациента из листа ожидания</span>
                          ) : walkFor === r.slot_id ? (
                            <form
                              className="flex gap-1"
                              onSubmit={(e) => {
                                e.preventDefault();
                                setWalkFor(null);
                                void run(() => staffApi.walkIn(token, r.slot_id, walkName), "Пациент записан через регистратуру.");
                              }}
                            >
                              <input autoFocus value={walkName} onChange={(e) => setWalkName(e.target.value)} placeholder="Имя пациента" className="flex-1 rounded-lg bg-[var(--card)] px-2 py-1 text-xs text-[var(--text)]" />
                              <button className="rounded-lg bg-[var(--btn)] px-2 text-xs text-[var(--btn-text)]">Записать</button>
                              <button type="button" onClick={() => setWalkFor(null)} className="px-2 text-xs">
                                ✕
                              </button>
                            </form>
                          ) : (
                            <span className="flex items-center gap-2">
                              свободно
                              {(role === "registrar" || role === "admin") && (
                                <button
                                  onClick={() => {
                                    setWalkFor(r.slot_id);
                                    setWalkName("");
                                  }}
                                  className="rounded-lg border border-[var(--btn)] px-2 py-0.5 text-xs text-[var(--link)]"
                                >
                                  + записать
                                </button>
                              )}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
