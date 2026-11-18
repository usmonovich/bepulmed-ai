import { useEffect, useState } from "react";
import { apiBase, getHealth, isAndroidApp, type Health } from "../lib/api";
import { dmedConfig } from "../lib/dmed";
import type { Lang } from "../lib/i18n";
import { isNativeApp, nativeCaps, setNetworkSpeech, speechVendor } from "../lib/voice";
import { clearTickets } from "../lib/ticketCache";

interface Item {
  ok: boolean;
  ru: string;
  uz: string;
}

/** «Защита данных»: какие меры реально действуют сейчас (из кода и с сервера), а не на бумаге. */
export function Privacy({ lang, visible }: { lang: Lang; visible: boolean }) {
  const ru = lang === "ru";
  const [h, setH] = useState<Health | null | "none">(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!visible) return;
    if (isAndroidApp && !apiBase()) return setH("none");
    let alive = true;
    getHealth()
      .then((x) => alive && setH(x))
      .catch(() => alive && setH("none"));
    return () => {
      alive = false;
    };
  }, [visible, tick]);

  let dmed = false;
  try {
    dmed = !!dmedConfig();
  } catch {
    dmed = false;
  }
  const caps = nativeCaps();
  const native = isNativeApp();
  const srv = h && h !== "none" ? h : null;

  const local: Item[] = [
    { ok: true, ru: "Помощник, триаж, первая помощь — на телефоне; симптомы не отправляются на сервер", uz: "Yordamchi, triaj, birinchi yordam — telefonda; alomatlar serverga yuborilmaydi" },
    { ok: true, ru: "Фото рецептов и анализов распознаются на телефоне (OCR), не загружаются", uz: "Retsept va tahlil rasmlari telefonda aniqlanadi (OCR), yuklanmaydi" },
    { ok: true, ru: "Медкарта SOS хранится только на этом устройстве", uz: "SOS tibbiy kartasi faqat shu qurilmada" },
    {
      ok: !native || !caps.netSpeechAllowed,
      ru: native
        ? caps.netSpeechAllowed
          ? `Голос: разрешено распознавание через ${speechVendor()} (вы включили) — можно отключить`
          : "Голос: только распознавание на телефоне"
        : "Голос в браузере отключён — речь не уходит на внешние серверы",
      uz: native
        ? caps.netSpeechAllowed
          ? `Ovoz: ${speechVendor()} orqali aniqlashga ruxsat berilgan — o‘chirish mumkin`
          : "Ovoz: faqat telefonda aniqlash"
        : "Brauzerda ovoz o‘chirilgan — nutq tashqi serverlarga yuborilmaydi",
    },
    { ok: true, ru: "ПИНФЛ приложение не запрашивает и не хранит", uz: "Ilova JShShIR so‘ramaydi va saqlamaydi" },
    { ok: true, ru: "Онлайн-справка (часы, рейтинг): наружу уходит только название учреждения и район — без местоположения и симптомов; личные запросы блокируются", uz: "Onlayn ma’lumot (ish vaqti, reyting): faqat muassasa nomi va tuman yuboriladi — joylashuv va alomatlarsiz; shaxsiy so‘rovlar bloklanadi" },
    {
      ok: true,
      ru: dmed ? "DMED: только чтение, с согласия, данные только в памяти телефона" : "DMED: не подключено (нет регистрации) — обмена с DMED нет",
      uz: dmed ? "DMED: faqat o‘qish, rozilik bilan, ma’lumotlar faqat telefon xotirasida" : "DMED: ulanmagan (ro‘yxatdan o‘tmagan) — DMED bilan almashinuv yo‘q",
    },
  ];

  const server: Item[] = srv
    ? [
        { ok: !srv.patientDataHostApproved, ru: srv.patientDataHostApproved ? "Запись к врачу включена: хостинг пациентских данных утверждён администратором" : "Пациентские данные на сервере не хранятся (запись выключена до утверждения хостинга в Узбекистане)", uz: srv.patientDataHostApproved ? "Yozilish yoqilgan: bemor ma’lumotlari hostingi tasdiqlangan" : "Bemor ma’lumotlari serverda saqlanmaydi (O‘zbekistondagi hosting tasdiqlanguncha yozilish o‘chiq)" },
        { ok: !srv.serverHealthChat, ru: srv.serverHealthChat ? "Серверный медицинский чат включён администратором" : "Серверный медицинский чат выключен", uz: srv.serverHealthChat ? "Server tibbiy chati yoqilgan" : "Server tibbiy chati o‘chiq" },
        { ok: !srv.ai, ru: srv.ai ? "Внешний ИИ включён администратором (с разрешением на передачу)" : "Внешний ИИ (Gemini) выключен — сообщения не уходят за рубеж", uz: srv.ai ? "Tashqi SI yoqilgan" : "Tashqi SI (Gemini) o‘chiq — xabarlar chet elga ketmaydi" },
        { ok: !srv.voice, ru: srv.voice ? "Внешний голосовой сервис включён администратором" : "Внешний голосовой сервис выключен", uz: srv.voice ? "Tashqi ovoz xizmati yoqilgan" : "Tashqi ovoz xizmati o‘chiq" },
      ]
    : [];

  const row = (i: Item, k: string) => (
    <li key={k} className="flex gap-2" data-testid="privacy-item" data-ok={i.ok}>
      <span>{i.ok ? "✅" : "⚠️"}</span>
      <span>{ru ? i.ru : i.uz}</span>
    </li>
  );

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3 text-sm" data-testid="privacy">
      <h2 className="text-base font-semibold">{ru ? "🔒 Защита данных" : "🔒 Ma’lumotlar himoyasi"}</h2>
      <p className="text-xs text-[var(--hint)]">
        {ru
          ? "Сведения о здоровье — особая категория персональных данных (ст. 25 Закона РУз № ЗРУ-547). Ниже — что действует прямо сейчас."
          : "Sog‘liq haqidagi ma’lumotlar — maxsus toifadagi shaxsiy ma’lumotlar (ZRU-547, 25-modda). Quyida hozir amalda bo‘lgan choralar."}
      </p>
      <div className="rounded-2xl bg-[var(--card)] p-3">
        <div className="mb-2 font-medium">{ru ? "На телефоне" : "Telefonda"}</div>
        <ul className="space-y-1.5 text-xs">{local.map((i, k) => row(i, `l${k}`))}</ul>
        <div className="mt-3 flex flex-wrap gap-2">
          {native && caps.netSpeechAllowed && (
            <button className="rounded-lg border border-black/15 px-2 py-1 text-xs" onClick={() => { setNetworkSpeech(false); setTick((n) => n + 1); }}>
              {ru ? `Запретить ${speechVendor()}-распознавание` : `${speechVendor()} aniqlashni taqiqlash`}
            </button>
          )}
          <button className="rounded-lg border border-black/15 px-2 py-1 text-xs" data-testid="privacy-clear-tickets" onClick={() => { clearTickets(); setTick((n) => n + 1); }}>
            {ru ? "Удалить сохранённые талоны" : "Saqlangan talonlarni o‘chirish"}
          </button>
        </div>
      </div>
      <div className="rounded-2xl bg-[var(--card)] p-3" data-testid="privacy-server">
        <div className="mb-2 font-medium">{ru ? "Сервер BepulMed" : "BepulMed serveri"}</div>
        {h === null && <p className="text-xs">…</p>}
        {h === "none" && <p className="text-xs">{ru ? "Сервер не подключён или недоступен — на сервер ничего не отправляется." : "Server ulanmagan yoki mavjud emas — serverga hech narsa yuborilmaydi."}</p>}
        {srv && <ul className="space-y-1.5 text-xs">{server.map((i, k) => row(i, `s${k}`))}</ul>}
      </div>
      <p className="text-[11px] text-[var(--hint)]">
        {ru
          ? "Это технические меры, не юридическое заключение. Перед работой с реальными пациентами нужна проверка юриста, утверждённый хостинг в Узбекистане и регистрация в DMED."
          : "Bu texnik choralar, yuridik xulosa emas. Haqiqiy bemorlar bilan ishlashdan oldin yurist tekshiruvi, O‘zbekistonda tasdiqlangan hosting va DMED’da ro‘yxatdan o‘tish kerak."}
      </p>
    </div>
  );
}
