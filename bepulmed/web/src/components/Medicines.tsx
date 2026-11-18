import { useEffect, useMemo, useState } from "react";
import { FREE_MEDS, GROUPS, MEDS_SOURCE, type FreeMed, type MedGroup } from "../data/freeMeds";
import { search } from "../lib/search";
import type { Lang } from "../lib/i18n";
import { openLink } from "../lib/telegram";
import { VoiceInput } from "./VoiceInput";
import { MED_SOURCES } from "../lib/placeInfo";

// Бесплатные лекарства по программе реимбурсации: полный перечень (69) + поиск по описанию, названию, симптому.

/** Совместимость со старым кодом и тестами: входит ли препарат в перечень. */
export function isMentioned(query: string): boolean | null {
  if (query.trim().length < 4) return null;
  return searchMeds(query).length > 0;
}

export function searchMeds(query: string) {
  return search(FREE_MEDS, query, (m) => [
    { text: m.ru, weight: 1 },
    { text: m.uz, weight: 1 },
    { text: (m.brands ?? []).join(" "), weight: 0.95 },
    { text: (m.keys ?? []).join(" "), weight: 0.8 },
    { text: `${GROUPS[m.group].ru} ${GROUPS[m.group].uz} ${GROUPS[m.group].keys.join(" ")}`, weight: 0.6 },
  ]);
}

const T = {
  ru: {
    title: "Бесплатные лекарства",
    sub: "69 препаратов программы реимбурсации: бесплатно по электронному рецепту семейного врача",
    ph: "Название или для чего: «от давления», «сахар», «конкор»",
    found: "Найдено",
    none: "В перечне не нашлось. Попробуйте другое слово (например, болезнь) или спросите семейного врача.",
    all: "Все",
    forms: "Форма",
    brands: "Например",
    how: "Как получить бесплатно",
    steps: [
      "Прикрепитесь к семейной поликлинике по месту жительства (если ещё нет).",
      "Семейный врач при показаниях выписывает электронный рецепт по МНН (действующему веществу).",
      "Идите в аптеку, у которой есть договор с Фондом медстрахования (ФГМС).",
      "Назовите рецепт и SMS-код, который придёт на телефон, — лекарство выдадут бесплатно.",
    ],
    warn: "Не начинайте и не меняйте лечение самостоятельно: препарат и дозу подбирает врач. Торговые названия — примеры, в аптеке может быть другой производитель того же вещества.",
    effective: "Перечень действует с 1 января 2027 г. До этой даты бесплатно выдаётся прежний, более короткий перечень — уточняйте у семейного врача.",
    source: "Источник",
    why: "совпало",
  },
  uz: {
    title: "Bepul dorilar",
    sub: "Reimbursatsiya dasturining 69 ta dorisi: oilaviy shifokorning elektron retsepti bo‘yicha bepul",
    ph: "Nomi yoki nima uchun: «bosim uchun», «qand», «konkor»",
    found: "Topildi",
    none: "Ro‘yxatda topilmadi. Boshqa so‘z bilan (masalan, kasallik nomi) urinib ko‘ring yoki oilaviy shifokordan so‘rang.",
    all: "Hammasi",
    forms: "Shakli",
    brands: "Masalan",
    how: "Qanday qilib bepul olish mumkin",
    steps: [
      "Yashash joyingizdagi oilaviy poliklinikaga biriktiriling (agar hali biriktirilmagan bo‘lsangiz).",
      "Oilaviy shifokor ko‘rsatma bo‘lsa, XPN (ta’sir etuvchi modda) bo‘yicha elektron retsept yozadi.",
      "Davlat tibbiy sug‘urta jamg‘armasi bilan shartnomasi bor dorixonaga boring.",
      "Retsept va telefoningizga kelgan SMS-kodni ayting — dori bepul beriladi.",
    ],
    warn: "Davolanishni o‘zingiz boshlamang va o‘zgartirmang: dori va dozani shifokor tanlaydi. Savdo nomlari — misol, dorixonada xuddi shu moddaning boshqa ishlab chiqaruvchisi bo‘lishi mumkin.",
    effective: "Ro‘yxat 2027-yil 1-yanvardan amal qiladi. Ungacha avvalgi, qisqaroq ro‘yxat bo‘yicha beriladi — oilaviy shifokordan aniqlang.",
    source: "Manba",
    why: "mos keldi",
  },
};

function MedCard({ m, lang, matched, onPharmacies }: { m: FreeMed; lang: Lang; matched?: string[]; onPharmacies?: () => void }) {
  const L = T[lang];
  const g = GROUPS[m.group];
  return (
    <div className="rounded-2xl bg-[var(--card)] p-3" data-testid="med-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{lang === "uz" ? m.uz : m.ru}</div>
          <div className="text-xs text-[var(--hint)]">{lang === "uz" ? m.ru : m.uz}</div>
        </div>
        <span className="shrink-0 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">{lang === "uz" ? "BEPUL" : "БЕСПЛАТНО"}</span>
      </div>
      <div className="mt-1 text-xs">
        {g.icon} {lang === "uz" ? g.uz : g.ru}
      </div>
      <div className="mt-1 text-xs text-[var(--hint)]">
        {L.forms}: {m.forms}
      </div>
      {m.brands?.length ? (
        <div className="text-xs text-[var(--hint)]">
          {L.brands}: {m.brands.join(", ")}
        </div>
      ) : null}
      {m.note && <div className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">⚠️ {m.note}</div>}
      {matched?.length ? <div className="mt-1 truncate text-[10px] text-[var(--hint)]">🔎 {L.why}: {matched.join(" · ").slice(0, 80)}</div> : null}
      <WhereToBuy lang={lang} onPharmacies={onPharmacies} />
    </div>
  );
}

/** «Где купить»: открытые аптеки (на телефоне) и официальные/проверенные источники цен (открывает сам человек). */
function WhereToBuy({ lang, onPharmacies }: { lang: Lang; onPharmacies?: () => void }) {
  const ru = lang === "ru";
  return (
    <details className="mt-2 text-xs" data-testid="where-to-buy">
      <summary className="cursor-pointer text-[var(--link)]">{ru ? "🛒 Где купить и сверить цену" : "🛒 Qayerdan olish va narxni tekshirish"}</summary>
      <div className="mt-1 space-y-1">
        {onPharmacies && (
          <button onClick={onPharmacies} className="w-full rounded-lg bg-emerald-600 py-1.5 font-medium text-white" data-testid="open-pharmacies">
            🟢 {ru ? "Аптеки рядом, открытые сейчас" : "Yaqin, hozir ochiq dorixonalar"}
          </button>
        )}
        {MED_SOURCES.map((s) => (
          <button key={s.id} onClick={() => openLink(s.url)} className="flex w-full items-center justify-between rounded-lg border border-black/10 px-2 py-1.5 text-left">
            <span>{ru ? s.ru : s.uz}</span>
            {s.official && <span className="ml-2 shrink-0 rounded bg-sky-100 px-1 text-[10px] text-sky-800">{ru ? "официально" : "rasmiy"}</span>}
          </button>
        ))}
        <p className="text-[10px] text-[var(--hint)]">
          {ru
            ? "Аптека не вправе продавать рецептурное лекарство дороже референтной цены — сверьте на pharm.gov.uz или в приложении PharmUz. Сайты открываются в браузере; BepulMed ничего о вас не передаёт."
            : "Dorixona retseptli dorini referent narxdan qimmat sotishga haqli emas — pharm.gov.uz yoki PharmUz ilovasida tekshiring. Saytlar brauzerda ochiladi; BepulMed siz haqingizda hech narsa yubormaydi."}
        </p>
      </div>
    </details>
  );
}

export function Medicines({ lang, query: externalQuery, onPharmacies }: { lang: Lang; query?: { text: string; n: number }; onPharmacies?: () => void }) {
  const L = T[lang];
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<MedGroup | "all">("all");
  const [showHow, setShowHow] = useState(false);

  // Запрос от голосового помощника («бесплатные лекарства от давления»).
  useEffect(() => {
    if (externalQuery?.text) {
      setQ(externalQuery.text);
      setGroup("all");
    }
  }, [externalQuery]);

  const hits = useMemo(() => (q.trim() ? searchMeds(q) : null), [q]);
  const list = hits ? hits.filter((h) => group === "all" || h.item.group === group) : FREE_MEDS.filter((m) => group === "all" || m.group === group).map((item) => ({ item, matched: [] as string[] }));
  const counts = useMemo(() => {
    const c: Partial<Record<MedGroup, number>> = {};
    for (const m of FREE_MEDS) c[m.group] = (c[m.group] ?? 0) + 1;
    return c;
  }, []);

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3 text-sm" data-testid="meds">
      <div>
        <h2 className="text-base font-semibold">💊 {L.title}</h2>
        <p className="text-xs text-[var(--hint)]">{L.sub}</p>
      </div>

      <div className="sticky top-0 z-10 -mx-3 bg-[var(--bg)] px-3 pb-2">
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={80}
            placeholder={L.ph}
            className="min-w-0 flex-1 rounded-xl bg-[var(--card)] px-3 py-2.5 outline-none"
            aria-label={L.ph}
            data-testid="meds-search"
          />
          <VoiceInput lang={lang} onText={setQ} />
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          <button onClick={() => setGroup("all")} className={`shrink-0 rounded-full px-3 py-1 text-xs ${group === "all" ? "bg-[var(--btn)] text-[var(--btn-text)]" : "bg-[var(--card)]"}`}>
            {L.all} · {FREE_MEDS.length}
          </button>
          {(Object.keys(GROUPS) as MedGroup[]).map((g) => (
            <button key={g} onClick={() => setGroup(g)} className={`shrink-0 rounded-full px-3 py-1 text-xs ${group === g ? "bg-[var(--btn)] text-[var(--btn-text)]" : "bg-[var(--card)]"}`}>
              {GROUPS[g].icon} {(lang === "uz" ? GROUPS[g].uz : GROUPS[g].ru).split(" ").slice(0, 2).join(" ")} · {counts[g]}
            </button>
          ))}
        </div>
      </div>

      {hits && (
        <p className="text-xs text-[var(--hint)]" data-testid="meds-count">
          {L.found}: {list.length}
        </p>
      )}
      {hits && list.length === 0 && <p className="rounded-xl bg-amber-50 p-3 text-amber-900">{L.none}</p>}
      <div className="space-y-2">
        {list.map((h) => (
          <MedCard key={h.item.n} m={h.item} lang={lang} matched={h.matched} onPharmacies={onPharmacies} />
        ))}
      </div>

      <div className="rounded-2xl bg-[var(--card)] p-3">
        <button onClick={() => setShowHow((v) => !v)} className="flex w-full items-center justify-between font-semibold">
          <span>📋 {L.how}</span>
          <span>{showHow ? "▲" : "▼"}</span>
        </button>
        {showHow && (
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {L.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        )}
      </div>
      <p className="rounded-xl bg-amber-50 p-2 text-xs text-amber-900">⚠️ {L.warn}</p>
      <p className="text-xs text-[var(--hint)]">ℹ️ {L.effective}</p>
      <div className="text-xs">
        <span className="text-[var(--hint)]">{L.source}: </span>
        <button onClick={() => openLink(MEDS_SOURCE.url)} className="text-left text-[var(--link)] underline">
          {MEDS_SOURCE.title}
        </button>
      </div>
      <div className="h-2" />
    </div>
  );
}
