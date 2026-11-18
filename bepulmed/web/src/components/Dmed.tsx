import { useEffect, useRef, useState } from "react";
import {
  buildAuthorizeUrl,
  dmedConfig,
  exchangeCode,
  loadDmed,
  onAuthCallback,
  openLogin,
  parseCallback,
  type DmedConfig,
  type DmedData,
  setDmedSession,
  type Token,
} from "../lib/dmed";
import type { Lang } from "../lib/i18n";

type Phase = "idle" | "consent" | "redirect" | "loading" | "ready" | "error";

const ERR: Record<string, [string, string]> = {
  denied: ["Вход в DMED отменён.", "DMED’ga kirish bekor qilindi."],
  expired: ["Время входа истекло. Попробуйте ещё раз.", "Kirish vaqti tugadi. Qayta urinib ko‘ring."],
  state_mismatch: ["Ответ DMED не прошёл проверку безопасности. Войдите заново.", "DMED javobi xavfsizlik tekshiruvidan o‘tmadi. Qayta kiring."],
  network: ["Нет связи с DMED. Нужен интернет.", "DMED bilan aloqa yo‘q. Internet kerak."],
  unauthorized: ["Сеанс DMED закончился. Войдите заново.", "DMED seansi tugadi. Qayta kiring."],
  patient_ambiguous: ["DMED не вернул вашу карту однозначно. Обратитесь в поддержку DMED.", "DMED kartangizni aniq qaytarmadi. DMED qo‘llab-quvvatlashiga murojaat qiling."],
  token_failed: ["DMED не выдал доступ. Проверьте регистрацию приложения.", "DMED ruxsat bermadi. Ilova ro‘yxatdan o‘tganini tekshiring."],
  sso_error: ["Ошибка входа DMED.", "DMED kirish xatosi."],
};

const RX_STATUS: Record<string, [string, string]> = {
  active: ["действует", "amalda"],
  completed: ["завершён", "yakunlangan"],
  "on-hold": ["приостановлен", "to‘xtatilgan"],
  stopped: ["отменён", "bekor qilingan"],
  cancelled: ["отменён", "bekor qilingan"],
  draft: ["черновик", "qoralama"],
};

const fmt = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d) ? iso : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** Подключение к DMED. Данные только читаются, хранятся в памяти и исчезают при выходе/закрытии. */
export function Dmed({ lang, onOpen }: { lang: Lang; onOpen: () => void }) {
  const ru = lang === "ru";
  const t = (k: string) => (ERR[k] ?? [`Ошибка DMED (${k}).`, `DMED xatosi (${k}).`])[ru ? 0 : 1];
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState("");
  const [data, setData] = useState<DmedData | null>(null);
  const token = useRef<Token | null>(null);
  let cfg: DmedConfig | null = null;
  let cfgError = "";
  try {
    cfg = dmedConfig();
  } catch (e) {
    cfgError = String((e as Error).message);
  }
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  async function refresh() {
    const c = cfgRef.current;
    if (!c || !token.current) return;
    setPhase("loading");
    try {
      setData(await loadDmed(c, token.current));
      setPhase("ready");
    } catch (e) {
      const code = (e as Error).message;
      if (code === "unauthorized") {
        token.current = null;
        setDmedSession(null);
      }
      setErr(t(code));
      setPhase("error");
    }
  }

  useEffect(
    () =>
      onAuthCallback(async (url) => {
        onOpen();
        const c = cfgRef.current;
        const r = parseCallback(url);
        if (!c || !r) return;
        if (!r.ok) {
          setErr(t(r.error));
          return setPhase("error");
        }
        setPhase("loading");
        try {
          token.current = await exchangeCode(c, r.code, r.verifier);
          setDmedSession(token.current);
          await refresh();
        } catch (e) {
          setErr(t((e as Error).message));
          setPhase("error");
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function logout() {
    token.current = null;
    setDmedSession(null);
    setData(null);
    setErr("");
    setPhase("idle");
  }

  const card = "rounded-2xl bg-[var(--card)] p-3";

  if (!cfg) {
    return (
      <div className="h-full space-y-3 overflow-y-auto p-3 text-sm" data-testid="dmed" data-state="not-registered">
        <h2 className="text-base font-semibold">DMED</h2>
        <div className={`${card} border border-amber-300`}>
          <p className="font-medium">{ru ? "⏳ Не подключено: приложение ещё не зарегистрировано в DMED" : "⏳ Ulanmagan: ilova hali DMED’da ro‘yxatdan o‘tmagan"}</p>
          <p className="mt-1 text-xs text-[var(--hint)]">
            {ru
              ? "Подключение готово по официальной спецификации Цифровой платформы здравоохранения (FHIR, вход через sso.dhp.uz). Для включения Uzinfocom должен выдать приложению client_id."
              : "Ulanish Raqamli sog‘liqni saqlash platformasining rasmiy spetsifikatsiyasi bo‘yicha tayyor (FHIR, sso.dhp.uz orqali kirish). Yoqish uchun Uzinfocom ilovaga client_id berishi kerak."}
          </p>
          {cfgError && <p className="mt-1 text-xs text-red-700">{cfgError}</p>}
        </div>
        <div className={card}>
          <p className="font-medium">{ru ? "Что будет доступно после подключения" : "Ulangandan keyin nima bo‘ladi"}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            <li>{ru ? "Ваша поликлиника прикрепления" : "Biriktirilgan poliklinikangiz"}</li>
            <li>{ru ? "Электронные рецепты — с пометкой, какие лекарства бесплатны по программе" : "Elektron retseptlar — qaysi dorilar dastur bo‘yicha bepulligi belgisi bilan"}</li>
            <li>{ru ? "Предстоящие записи к врачу" : "Shifokorga navbatdagi yozilishlar"}</li>
          </ul>
          <p className="mt-2 text-xs text-[var(--hint)]">
            {ru
              ? "Вход — через DMED, ПИНФЛ и пароль приложение не видит. Только чтение. Данные остаются в памяти телефона и не передаются на сервер BepulMed."
              : "Kirish — DMED orqali, ilova JShShIR va parolni ko‘rmaydi. Faqat o‘qish. Ma’lumotlar telefon xotirasida qoladi va BepulMed serveriga yuborilmaydi."}
          </p>
        </div>
        <p className="text-xs text-[var(--hint)]">DMED: +998 71 202 50 00 · info@dmed.uz</p>
      </div>
    );
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3 text-sm" data-testid="dmed" data-state={phase}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">DMED</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px]">{cfg.env === "production" ? "fhir.dhp.uz" : ru ? "тестовый контур" : "test muhit"}</span>
      </div>

      {(phase === "idle" || phase === "error") && (
        <>
          {err && <p className="rounded-xl bg-red-50 p-2 text-red-800" data-testid="dmed-error">{err}</p>}
          <button onClick={() => setPhase("consent")} className="w-full rounded-xl bg-[var(--btn)] py-3 font-medium text-[var(--btn-text)]" data-testid="dmed-login">
            {ru ? "🔐 Войти через DMED" : "🔐 DMED orqali kirish"}
          </button>
          <p className="text-xs text-[var(--hint)]">
            {ru ? "Покажем поликлинику прикрепления, электронные рецепты и записи из DMED." : "DMED’dan poliklinika, elektron retseptlar va yozilishlarni ko‘rsatamiz."}
          </p>
        </>
      )}

      {phase === "consent" && (
        <div className={`${card} border border-emerald-300`} data-testid="dmed-consent">
          <p className="font-medium">{ru ? "Согласие на чтение данных DMED" : "DMED ma’lumotlarini o‘qishga rozilik"}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            <li>{ru ? "Читаем: ФИО, поликлинику прикрепления, электронные рецепты, записи к врачу." : "O‘qiymiz: F.I.Sh., biriktirilgan poliklinika, elektron retseptlar, yozilishlar."}</li>
            <li>{ru ? "Ничего не меняем в DMED." : "DMED’da hech narsani o‘zgartirmaymiz."}</li>
            <li>{ru ? "Данные — только в памяти этого телефона, не сохраняются и не отправляются на сервер BepulMed или во внешний ИИ." : "Ma’lumotlar faqat shu telefon xotirasida, saqlanmaydi va BepulMed serveriga yoki tashqi SI’ga yuborilmaydi."}</li>
            <li>{ru ? "Вход и подтверждение личности — на сайте DMED; ПИНФЛ и пароль приложение не получает." : "Kirish va shaxsni tasdiqlash — DMED saytida; ilova JShShIR va parolni olmaydi."}</li>
            <li>{ru ? "«Выйти» — сразу удаляет всё с устройства." : "«Chiqish» — hammasini qurilmadan darhol o‘chiradi."}</li>
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              className="flex-1 rounded-xl bg-[var(--btn)] py-2 font-medium text-[var(--btn-text)]"
              data-testid="dmed-consent-yes"
              onClick={() => {
                setPhase("redirect");
                openLogin(buildAuthorizeUrl(cfg!));
              }}
            >
              {ru ? "Согласен, войти" : "Roziman, kirish"}
            </button>
            <button className="rounded-xl border border-black/15 px-3" onClick={() => setPhase("idle")}>
              {ru ? "Отмена" : "Bekor"}
            </button>
          </div>
        </div>
      )}

      {phase === "redirect" && <p data-testid="dmed-redirect">{ru ? "Открываю вход DMED… После входа вернитесь в приложение." : "DMED kirish ochilmoqda… Kirgandan so‘ng ilovaga qayting."}</p>}
      {phase === "loading" && <p>{ru ? "Загружаю данные DMED…" : "DMED ma’lumotlari yuklanmoqda…"}</p>}

      {phase === "ready" && data && (
        <div className="space-y-3" data-testid="dmed-data">
          <div className={card}>
            <div className="text-xs text-[var(--hint)]">{ru ? "Пациент" : "Bemor"}</div>
            <div className="font-medium" data-testid="dmed-patient">{data.patient.name}</div>
            {data.clinic && (
              <div className="mt-2" data-testid="dmed-clinic">
                <div className="text-xs text-[var(--hint)]">{ru ? "Поликлиника прикрепления" : "Biriktirilgan poliklinika"}</div>
                <div>🏥 {data.clinic.name}</div>
                {data.clinic.address && <div className="text-xs">📍 {data.clinic.address}</div>}
                {data.clinic.phone && (
                  <a className="text-xs text-[var(--link)] underline" href={`tel:${data.clinic.phone.replace(/[^\d+]/g, "")}`}>
                    📞 {data.clinic.phone}
                  </a>
                )}
              </div>
            )}
          </div>

          <div className={card}>
            <div className="mb-1 font-medium">{ru ? "💊 Электронные рецепты" : "💊 Elektron retseptlar"}</div>
            {!data.prescriptions.length && <p className="text-xs text-[var(--hint)]">{ru ? "Рецептов нет." : "Retseptlar yo‘q."}</p>}
            <ul className="space-y-2">
              {data.prescriptions.map((p) => (
                <li key={p.id} className="border-t border-black/5 pt-2 first:border-0 first:pt-0" data-testid="dmed-rx">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{p.name}</span>
                    {p.free && (
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800" data-testid="dmed-rx-free">
                        {ru ? "бесплатно по программе" : "dastur bo‘yicha bepul"}
                      </span>
                    )}
                  </div>
                  {p.dosage && <div className="text-xs">{p.dosage}</div>}
                  <div className="text-[11px] text-[var(--hint)]">
                    {[p.date, p.requester, RX_STATUS[p.status]?.[ru ? 0 : 1] ?? p.status].filter(Boolean).join(" · ")}
                  </div>
                </li>
              ))}
            </ul>
            {data.prescriptions.some((p) => p.free) && (
              <p className="mt-2 text-[11px] text-[var(--hint)]">
                {ru
                  ? "Отметка «бесплатно» — по перечню реимбурсации (приказ МЗ № 18 от 23.04.2026); выдаётся в аптеках с договором ФГМ."
                  : "«Bepul» belgisi — reimbursatsiya ro‘yxati bo‘yicha (SSV 18-son buyrug‘i, 23.04.2026); DTSJ shartnomasi bor dorixonalarda beriladi."}
              </p>
            )}
          </div>

          <div className={card}>
            <div className="mb-1 font-medium">{ru ? "📅 Записи к врачу" : "📅 Shifokorga yozilishlar"}</div>
            {!data.appointments.length && <p className="text-xs text-[var(--hint)]">{ru ? "Предстоящих записей нет." : "Navbatdagi yozilishlar yo‘q."}</p>}
            <ul className="space-y-1">
              {data.appointments.map((a) => (
                <li key={a.id} className="text-xs" data-testid="dmed-appt">
                  <b>{fmt(a.start)}</b> — {[a.service, a.who].filter(Boolean).join(", ") || "—"}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex gap-2">
            <button onClick={() => void refresh()} className="flex-1 rounded-xl border border-black/15 py-2">
              {ru ? "↻ Обновить" : "↻ Yangilash"}
            </button>
            <button onClick={logout} className="flex-1 rounded-xl bg-red-50 py-2 text-red-800" data-testid="dmed-logout">
              {ru ? "Выйти и удалить с телефона" : "Chiqish va o‘chirish"}
            </button>
          </div>
          <p className="text-[11px] text-[var(--hint)]">
            {ru ? `Данные DMED на ${fmt(new Date(data.fetchedAt).toISOString())}. Хранятся только в памяти до выхода.` : `DMED ma’lumotlari ${fmt(new Date(data.fetchedAt).toISOString())} holatiga. Faqat chiqquncha xotirada.`}
          </p>
        </div>
      )}
    </div>
  );
}
