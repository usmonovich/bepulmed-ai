import { useState } from "react";
import { ApiError, normalizeServer, probeServer, saveServer, savedServer } from "../lib/api";
import type { Lang } from "../lib/i18n";

// Подключение Android-приложения к серверу BepulMed (Cloudflare Worker). В Telegram не показывается.

const T = {
  ru: {
    title: "Подключение к серверу",
    intro: "Запись к врачу, очередь и ИИ-ответы работают через сервер BepulMed. Укажите адрес, который выдала команда npx wrangler deploy (вида bepulmed-ai.имя.workers.dev).",
    offline: "Без сервера работают: карта Ташкента, помощник по базе источников, сканер, SOS и медкарта.",
    placeholder: "bepulmed-ai.имя.workers.dev",
    check: "Проверить и подключить",
    checking: "Проверяем…",
    ok: "Подключено. Перезапускаем…",
    bad: "Неверный адрес. Нужен https://… (http — только для локальной сети).",
    network: "Сервер не отвечает. Проверьте адрес и интернет.",
    notBm: "По этому адресу не сервер BepulMed.",
    current: "Сейчас:",
  },
  uz: {
    title: "Serverga ulanish",
    intro: "Shifokorga yozilish, navbat va AI javoblari BepulMed serveri orqali ishlaydi. npx wrangler deploy buyrug‘i bergan manzilni kiriting (bepulmed-ai.nomi.workers.dev kabi).",
    offline: "Serversiz ishlaydi: Toshkent xaritasi, manbalar bazasi bo‘yicha yordamchi, skaner, SOS va tibbiy karta.",
    placeholder: "bepulmed-ai.nomi.workers.dev",
    check: "Tekshirish va ulash",
    checking: "Tekshirilmoqda…",
    ok: "Ulandi. Qayta ishga tushirilmoqda…",
    bad: "Manzil noto‘g‘ri. https://… kerak (http — faqat mahalliy tarmoq uchun).",
    network: "Server javob bermayapti. Manzil va internetni tekshiring.",
    notBm: "Bu manzilda BepulMed serveri yo‘q.",
    current: "Hozir:",
  },
};

export function ServerSetup({ lang }: { lang: Lang }) {
  const L = T[lang];
  const [value, setValue] = useState(savedServer());
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    const origin = normalizeServer(value);
    if (!origin) return setMsg({ text: L.bad, ok: false });
    setBusy(true);
    setMsg({ text: L.checking, ok: true });
    try {
      await probeServer(origin);
      saveServer(origin);
      setMsg({ text: L.ok, ok: true });
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      setMsg({ text: err instanceof ApiError && err.code === "not_bepulmed" ? L.notBm : L.network, ok: false });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={connect} className="space-y-3 p-4 text-sm" data-testid="server-setup">
      <h2 className="text-base font-semibold">⚙️ {L.title}</h2>
      <p>{L.intro}</p>
      <p className="text-xs text-emerald-700">✅ {L.offline}</p>
      {savedServer() && (
        <p className="break-all text-xs text-[var(--hint)]">
          {L.current} {savedServer()}
        </p>
      )}
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={L.placeholder} inputMode="url" autoCapitalize="off" autoCorrect="off" className="w-full rounded-xl bg-[var(--card)] px-3 py-2.5" aria-label={L.title} />
      <button disabled={busy} className="w-full rounded-xl bg-[var(--btn)] py-2.5 font-medium text-[var(--btn-text)] disabled:opacity-50">
        {busy ? L.checking : L.check}
      </button>
      {msg && <p className={msg.ok ? "text-emerald-700" : "text-red-700"}>{msg.text}</p>}
    </form>
  );
}
