import { useEffect, useState } from "react";
import { isAndroidApp } from "../lib/api";
import { BLOOD_TYPES, cleanPhone, clearCard, isEmptyCard, loadCard, saveCard, sosMessage, type MedCard } from "../lib/medcard";
import { haptic, inTelegram, requestLocation, tg } from "../lib/telegram";
import type { Lang } from "../lib/i18n";
import { EmergencyButtons } from "./Emergency";

// SOS и «Медкарта для экстренных случаев». Работает без сервера и без интернета (кроме отправки сообщения).

const T = {
  ru: {
    title: "Экстренная помощь",
    redFlags: "Звоните 103 сразу, не дожидаясь ответа приложения, если есть:",
    flags: ["боль или давление в груди", "затруднённое дыхание", "потеря сознания, судороги", "внезапная слабость лица, руки или речи", "сильное кровотечение", "тяжёлая травма или ожог"],
    share: "📍 Отправить близкому, где я",
    shareNote: "Определим местоположение и подготовим сообщение с вашей медкартой. Отправляете вы сами.",
    locating: "Определяем местоположение…",
    sent: "Сообщение подготовлено — выберите, кому отправить.",
    copied: "Текст скопирован — вставьте его в мессенджер или SMS.",
    noShare: "Не удалось открыть отправку. Текст ниже — скопируйте вручную.",
    callContact: "📞 Позвонить",
    cardTitle: "Медкарта для врачей скорой",
    cardEmpty: "Медкарта не заполнена. Заполните заранее — в экстренной ситуации это экономит время.",
    fill: "Заполнить медкарту",
    edit: "Изменить",
    privacy: "Медкарта хранится только на этом телефоне и никуда не отправляется — кроме сообщения, которое вы сами отправите близкому.",
    save: "Сохранить",
    cancel: "Отмена",
    clear: "Удалить медкарту",
    clearConfirm: "Удалить все данные медкарты с этого телефона?",
    saved: "Медкарта сохранена на этом телефоне.",
    notSaved: "Не удалось сохранить: хранилище недоступно.",
    f: { name: "Имя и фамилия", birthYear: "Год рождения", bloodType: "Группа крови", allergies: "Аллергии (лекарства, продукты)", conditions: "Хронические заболевания", medications: "Постоянные лекарства", contactName: "Близкий человек", contactPhone: "Телефон близкого", notes: "Важно знать (кардиостимулятор, беременность…)" },
    unknown: "Не знаю",
  },
  uz: {
    title: "Shoshilinch yordam",
    redFlags: "Ilova javobini kutmasdan darhol 103 ga qo‘ng‘iroq qiling, agar:",
    flags: ["ko‘krakda og‘riq yoki siqilish", "nafas olish qiyin", "hushdan ketish, tutqanoq", "yuz, qo‘l yoki nutqda to‘satdan zaiflik", "kuchli qon ketish", "og‘ir jarohat yoki kuyish"],
    share: "📍 Yaqinimga joylashuvimni yuborish",
    shareNote: "Joylashuvni aniqlab, tibbiy kartangiz bilan xabar tayyorlaymiz. Yuborishni o‘zingiz tanlaysiz.",
    locating: "Joylashuv aniqlanmoqda…",
    sent: "Xabar tayyor — kimga yuborishni tanlang.",
    copied: "Matn nusxalandi — messenjer yoki SMSga qo‘ying.",
    noShare: "Yuborishni ochib bo‘lmadi. Quyidagi matnni qo‘lda nusxalang.",
    callContact: "📞 Qo‘ng‘iroq",
    cardTitle: "Tez yordam uchun tibbiy karta",
    cardEmpty: "Tibbiy karta to‘ldirilmagan. Oldindan to‘ldiring — shoshilinch holatda vaqtni tejaydi.",
    fill: "Kartani to‘ldirish",
    edit: "O‘zgartirish",
    privacy: "Karta faqat shu telefonda saqlanadi va hech qayerga yuborilmaydi — yaqiningizga o‘zingiz yuboradigan xabardan tashqari.",
    save: "Saqlash",
    cancel: "Bekor qilish",
    clear: "Kartani o‘chirish",
    clearConfirm: "Kartadagi barcha ma’lumotlar shu telefondan o‘chirilsinmi?",
    saved: "Tibbiy karta shu telefonda saqlandi.",
    notSaved: "Saqlab bo‘lmadi: xotira mavjud emas.",
    f: { name: "Ism va familiya", birthYear: "Tug‘ilgan yil", bloodType: "Qon guruhi", allergies: "Allergiya (dorilar, mahsulotlar)", conditions: "Surunkali kasalliklar", medications: "Doimiy dorilar", contactName: "Yaqin kishi", contactPhone: "Yaqinining telefoni", notes: "Muhim (kardiostimulyator, homiladorlik…)" },
    unknown: "Bilmayman",
  },
};

type Status = { text: string; ok: boolean } | null;

/** Отправка текста: Android-оболочка → системное «Поделиться»; Telegram → выбор чата; браузер → share / SMS / буфер. */
async function shareText(text: string, phone: string, link: string | null): Promise<"native" | "shared" | "sms" | "copied"> {
  if (isAndroidApp) {
    window.location.href = "bepulmed://share?text=" + encodeURIComponent(text);
    return "native";
  }
  if (inTelegram && tg?.openTelegramLink) {
    const u = new URLSearchParams({ url: link ?? "https://maps.google.com", text });
    tg.openTelegramLink("https://t.me/share/url?" + u.toString().replace(/\+/g, "%20"));
    return "native";
  }
  if (navigator.share) {
    await navigator.share({ text });
    return "shared";
  }
  if (phone) {
    window.location.href = `sms:${phone}?body=${encodeURIComponent(text)}`;
    return "sms";
  }
  await navigator.clipboard.writeText(text);
  return "copied";
}

export function Sos({ lang, visible }: { lang: Lang; visible: boolean }) {
  const L = T[lang];
  const [card, setCard] = useState<MedCard>(loadCard);
  const [draft, setDraft] = useState<MedCard | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [fallbackText, setFallbackText] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setCard(loadCard());
  }, [visible]);

  const phone = cleanPhone(card.contactPhone);

  async function sendSos() {
    if (busy) return;
    haptic();
    setBusy(true);
    setFallbackText(null);
    setStatus({ text: L.locating, ok: true });
    let pos: { lat: number; lon: number } | null = null;
    try {
      pos = await Promise.race([requestLocation(), new Promise<never>((_, rej) => setTimeout(() => rej("timeout"), 12000))]);
    } catch {
      pos = null; // отправляем и без координат
    }
    const text = sosMessage(lang, card, pos);
    const link = pos ? text.match(/https:\/\/maps\.google\.com\/\S+/)?.[0] ?? null : null;
    try {
      const how = await shareText(text, phone, link);
      setStatus({ text: how === "copied" ? L.copied : L.sent, ok: true });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") setStatus(null); // пользователь закрыл окно «Поделиться»
      else {
        setStatus({ text: L.noShare, ok: false });
        setFallbackText(text);
      }
    } finally {
      setBusy(false);
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (saveCard(draft)) {
      setCard(loadCard());
      setDraft(null);
      setStatus({ text: L.saved, ok: true });
    } else setStatus({ text: L.notSaved, ok: false });
  }

  const field = (k: keyof MedCard, opts: { type?: string; inputMode?: "numeric" | "tel"; area?: boolean } = {}) => (
    <label key={k} className="flex flex-col gap-0.5">
      <span className="text-xs text-[var(--hint)]">{L.f[k]}</span>
      {opts.area ? (
        <textarea value={draft![k]} maxLength={300} rows={2} onChange={(e) => setDraft({ ...draft!, [k]: e.target.value })} className="rounded-lg bg-[var(--card)] px-2 py-1.5" />
      ) : (
        <input value={draft![k]} maxLength={k === "birthYear" ? 4 : 300} type={opts.type ?? "text"} inputMode={opts.inputMode} onChange={(e) => setDraft({ ...draft!, [k]: e.target.value })} className="rounded-lg bg-[var(--card)] px-2 py-1.5" />
      )}
    </label>
  );

  if (draft) {
    return (
      <form onSubmit={save} className="h-full space-y-2 overflow-y-auto p-3 text-sm" data-testid="medcard-form">
        <h2 className="text-base font-semibold">{L.cardTitle}</h2>
        <p className="text-xs text-[var(--hint)]">🔒 {L.privacy}</p>
        {field("name")}
        {field("birthYear", { inputMode: "numeric" })}
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-[var(--hint)]">{L.f.bloodType}</span>
          <select value={draft.bloodType} onChange={(e) => setDraft({ ...draft, bloodType: e.target.value })} className="rounded-lg bg-[var(--card)] px-2 py-1.5">
            <option value="">{L.unknown}</option>
            {BLOOD_TYPES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        {field("allergies", { area: true })}
        {field("conditions", { area: true })}
        {field("medications", { area: true })}
        {field("contactName")}
        {field("contactPhone", { type: "tel", inputMode: "tel" })}
        {field("notes", { area: true })}
        <div className="sticky bottom-0 flex gap-2 bg-[var(--bg)] py-2">
          <button className="flex-1 rounded-xl bg-[var(--btn)] py-2.5 font-medium text-[var(--btn-text)]">{L.save}</button>
          <button type="button" onClick={() => setDraft(null)} className="rounded-xl bg-[var(--card)] px-4">
            {L.cancel}
          </button>
        </div>
        {!isEmptyCard(card) && (
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(L.clearConfirm)) return;
              clearCard();
              setCard(loadCard());
              setDraft(null);
            }}
            className="w-full py-2 text-xs text-red-600 underline"
          >
            {L.clear}
          </button>
        )}
      </form>
    );
  }

  const rows: [string, string][] = (
    [
      ["name", card.name + (card.birthYear ? `, ${card.birthYear}` : "")],
      ["bloodType", card.bloodType],
      ["allergies", card.allergies],
      ["conditions", card.conditions],
      ["medications", card.medications],
      ["notes", card.notes],
      ["contactName", [card.contactName, card.contactPhone].filter(Boolean).join(" · ")],
    ] as [keyof MedCard, string][]
  )
    .filter(([, v]) => v.trim())
    .map(([k, v]) => [L.f[k], v]);

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3 text-sm" data-testid="sos">
      <h2 className="text-base font-semibold text-red-700">🆘 {L.title}</h2>
      <EmergencyButtons lang={lang} className="[&>a]:py-4 [&>a]:text-lg" />

      <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-red-950">
        <p className="font-medium">{L.redFlags}</p>
        <ul className="mt-1 list-disc pl-5 text-xs">
          {L.flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-2 rounded-2xl bg-[var(--card)] p-3">
        <button onClick={sendSos} disabled={busy} className="w-full rounded-xl bg-red-600 py-3 font-semibold text-white disabled:opacity-50" data-testid="sos-share">
          {busy ? L.locating : L.share}
        </button>
        {phone && (
          <a href={`tel:${phone}`} className="block w-full rounded-xl bg-white py-2.5 text-center font-medium text-red-700">
            {L.callContact}: {card.contactName || phone}
          </a>
        )}
        <p className="text-[11px] text-[var(--hint)]">{L.shareNote}</p>
        {status && (
          <p className={`text-xs ${status.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
            {status.text}
          </p>
        )}
        {fallbackText && <textarea readOnly value={fallbackText} rows={6} className="w-full rounded-lg bg-white p-2 text-xs" />}
      </div>

      <div className="rounded-2xl bg-[var(--card)] p-3" data-testid="medcard">
        <div className="flex items-center justify-between">
          <span className="font-semibold">🩺 {L.cardTitle}</span>
          {!isEmptyCard(card) && (
            <button onClick={() => setDraft({ ...card })} className="text-xs text-[var(--link)] underline">
              {L.edit}
            </button>
          )}
        </div>
        {isEmptyCard(card) ? (
          <>
            <p className="mt-1 text-xs text-[var(--hint)]">{L.cardEmpty}</p>
            <button onClick={() => setDraft({ ...card })} className="mt-2 w-full rounded-xl bg-[var(--btn)] py-2 font-medium text-[var(--btn-text)]">
              {L.fill}
            </button>
          </>
        ) : (
          <dl className="mt-2 space-y-1">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10px] uppercase tracking-wide text-[var(--hint)]">{k}</dt>
                <dd className={`font-medium ${k === L.f.allergies || k === L.f.bloodType ? "text-red-700" : ""}`}>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-2 text-[10px] text-[var(--hint)]">🔒 {L.privacy}</p>
      </div>
    </div>
  );
}
