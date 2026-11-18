import { useState } from "react";
import type { Facility } from "../lib/api";
import type { Lang } from "../lib/i18n";
import {
  bestMatch,
  dgisSearchLink,
  districtOf,
  facilityStatus,
  facilityWeek,
  kindOfFacility,
  lookupPlaces,
  openStatus,
  ownership,
  ownershipText,
  statusText,
  weekText,
  type LookupResult,
  type PlaceInfo,
} from "../lib/placeInfo";
import { openLink } from "../lib/telegram";

/** Бейджи «открыто сейчас» и «платно/бесплатно» — считаются на телефоне, без интернета. */
export function PlaceBadges({ f, lang, now = Date.now() }: { f: Facility; lang: Lang; now?: number }) {
  const st = facilityStatus(f, now);
  const own = ownership(f);
  return (
    <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
      {st && (
        <span className={`rounded-md px-1.5 py-0.5 ${st.open ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-700"}`} data-testid="open-status" data-open={st.open}>
          {st.open ? "🟢 " : "⚪ "}
          {statusText(st, lang)}
        </span>
      )}
      <span
        className={`rounded-md px-1.5 py-0.5 ${own === "free" ? "bg-sky-100 text-sky-800" : own === "paid" ? "bg-amber-100 text-amber-900" : "bg-gray-100 text-gray-600"}`}
        data-testid="ownership"
        data-own={own}
      >
        {own === "free" ? "🏛 " : own === "paid" ? "💳 " : ""}
        {ownershipText(own, lang)}
      </span>
    </div>
  );
}

const ERR: Record<string, [string, string]> = {
  no_server: ["Онлайн-справка работает через сервер BepulMed — подключите его в меню → Сервер. Пока можно открыть 2GIS.", "Onlayn ma’lumot BepulMed serveri orqali ishlaydi — menyu → Server. Hozircha 2GIS’ni ochish mumkin."],
  not_configured: ["На сервере не подключён источник рейтингов (2GIS). Можно открыть 2GIS.", "Serverda reyting manbai (2GIS) ulanmagan. 2GIS’ni ochish mumkin."],
  network: ["Нет интернета — рейтинг недоступен. Часы работы выше — из сохранённых данных.", "Internet yo‘q — reyting mavjud emas. Ish vaqti — saqlangan ma’lumotlardan."],
  failed: ["Источник не ответил. Попробуйте позже.", "Manba javob bermadi. Keyinroq urinib ko‘ring."],
  personal: ["Запрос не отправлен: в нём есть личные сведения.", "So‘rov yuborilmadi: unda shaxsiy ma’lumot bor."],
};

/** «Рейтинг и отзывы»: по нажатию спрашивает 2GIS через сервер. Отправляется только название и район. */
type PlaceLike = Pick<Facility, "name" | "kind" | "openingHours"> & { lat?: number; lon?: number };

export function PlaceOnline({ f, lang, district, lookup = lookupPlaces }: { f: PlaceLike; lang: Lang; district?: string; lookup?: typeof lookupPlaces }) {
  const ru = lang === "ru";
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<LookupResult | null>(null);
  const [hit, setHit] = useState<PlaceInfo | null>(null);
  const week = facilityWeek(f);

  async function run(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    const d = district ?? (f.lat != null && f.lon != null ? districtOf({ lat: f.lat, lon: f.lon }) : undefined);
    const r = await lookup({ kind: kindOfFacility(f), q: f.name.slice(0, 60), district: d });
    setRes(r);
    setHit(r.ok ? (bestMatch(f.name, r.places) ?? null) : null);
    setBusy(false);
  }

  return (
    <div className="mt-2 text-xs" onClick={(e) => e.stopPropagation()}>
      {week && <div className="text-[11px] text-[var(--hint)]">🕒 {weekText(week, lang)}</div>}
      {!res && (
        <button onClick={run} disabled={busy} className="mt-1 rounded-lg border border-black/15 px-2 py-1" data-testid="place-online">
          {busy ? "…" : ru ? "⭐ Рейтинг и отзывы (онлайн)" : "⭐ Reyting va sharhlar (onlayn)"}
        </button>
      )}
      {res && res.ok && hit && (
        <div className="mt-1 rounded-xl bg-black/[0.03] p-2" data-testid="place-online-result">
          <div className="font-medium">
            {hit.rating ? `⭐ ${hit.rating.toFixed(1)}` : ru ? "Без рейтинга" : "Reyting yo‘q"}
            {hit.reviews ? ` · ${hit.reviews} ${ru ? "отзывов" : "sharh"}` : ""}
            <span className="ml-1 text-[10px] font-normal text-[var(--hint)]">2GIS</span>
          </div>
          {hit.week && (
            <div>
              🕒 {statusText(openStatus(hit.week, Date.now()), lang)} · {weekText(hit.week, lang)}
            </div>
          )}
          {hit.scheduleNote && <div className="text-[11px]">{hit.scheduleNote}</div>}
          {!!hit.rubrics.length && <div className="text-[11px] text-[var(--hint)]">{hit.rubrics.slice(0, 3).join(", ")}</div>}
          <button className="mt-1 text-[var(--link)] underline" onClick={() => openLink(hit.link)}>
            {ru ? "Читать отзывы в 2GIS" : "2GIS’da sharhlarni o‘qish"}
          </button>
        </div>
      )}
      {res && res.ok && !hit && <div className="mt-1">{ru ? "В 2GIS не нашлось точного совпадения." : "2GIS’da aniq moslik topilmadi."}</div>}
      {res && !res.ok && (
        <div className="mt-1 text-amber-900" data-testid="place-online-error">
          {(ERR[res.error] ?? ERR.failed)[ru ? 0 : 1]}
        </div>
      )}
      {res && (!res.ok || !hit) && res.ok !== undefined && !(res.ok === false && res.error === "personal") && (
        <button className="mt-1 text-[var(--link)] underline" onClick={() => openLink(dgisSearchLink(f.name))}>
          {ru ? "Открыть в 2GIS" : "2GIS’da ochish"}
        </button>
      )}
      {res?.sent && (
        <div className="mt-1 text-[10px] text-[var(--hint)]" data-testid="place-online-sent">
          {ru ? "Отправлено только:" : "Faqat yuborildi:"} «{res.sent.q}»{res.sent.district ? (ru ? " и район" : " va tuman") : ""}.{" "}
          {ru ? "Ваше местоположение и данные о вас — нет." : "Joylashuvingiz va siz haqingizdagi ma’lumot — yo‘q."}
        </div>
      )}
    </div>
  );
}
