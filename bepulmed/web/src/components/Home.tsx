import { useState } from "react";
import { sttEngine } from "../lib/voice";
import type { Lang } from "../lib/i18n";

// Главный экран: большая кнопка в центре — сразу начать разговор с помощником; ниже — быстрые запросы и разделы.

type Go = "firstaid" | "map" | "meds" | "book" | "tickets" | "scanner" | "sos" | "chat";

const T = {
  ru: {
    hello: "Чем помочь?",
    sub: "Нажмите и скажите — помощник поймёт и откроет нужное. Работает без интернета.",
    talk: "Нажмите и говорите",
    typeIt: "Или напишите: «обжёгся», «ближайшая поликлиника»…",
    ask: "Спросить",
    quick: ["Что делать при ожоге?", "Ближайшая поликлиника", "Бесплатные лекарства от давления", "Вызови скорую"],
    tiles: [
      ["firstaid", "🚑", "Скорая помощь", "Что делать до приезда врачей"],
      ["map", "🏥", "Клиники Ташкента", "Поликлиники, центры, на карте"],
      ["meds", "💊", "Бесплатные лекарства", "69 препаратов, поиск по описанию"],
      ["book", "📅", "Запись к врачу", "Талон и очередь"],
      ["scanner", "🧾", "Сканер рецептов", "Распознать рецепт или анализ"],
      ["sos", "🆘", "SOS и медкарта", "Отправить близким, где я"],
      ["chat", "💬", "Вопрос помощнику", "Бесплатная медицина: что положено"],
      ["tickets", "🎫", "Мои талоны", "Очередь и время приёма"],
    ] as [Go, string, string, string][],
  },
  uz: {
    hello: "Qanday yordam beray?",
    sub: "Bosing va ayting — yordamchi tushunib, keraklisini ochadi. Internetsiz ishlaydi.",
    talk: "Bosing va gapiring",
    typeIt: "Yoki yozing: «kuydi», «eng yaqin poliklinika»…",
    ask: "So‘rash",
    quick: ["Kuyganda nima qilish kerak?", "Eng yaqin poliklinika", "Bosim uchun bepul dorilar", "Tez yordam chaqir"],
    tiles: [
      ["firstaid", "🚑", "Tez yordam", "Shifokorlar kelguncha nima qilish kerak"],
      ["map", "🏥", "Toshkent klinikalari", "Poliklinikalar, markazlar, xaritada"],
      ["meds", "💊", "Bepul dorilar", "69 ta dori, tavsif bo‘yicha qidiruv"],
      ["book", "📅", "Shifokorga yozilish", "Talon va navbat"],
      ["scanner", "🧾", "Retsept skaneri", "Retsept yoki tahlilni tanib olish"],
      ["sos", "🆘", "SOS va tibbiy karta", "Yaqinlarga joylashuvni yuborish"],
      ["chat", "💬", "Yordamchiga savol", "Bepul tibbiyot: nima bepul"],
      ["tickets", "🎫", "Talonlarim", "Navbat va qabul vaqti"],
    ] as [Go, string, string, string][],
  },
};

export function Home({ lang, onTalk, onAsk, onGo }: { lang: Lang; onTalk: () => void; onAsk: (text: string) => void; onGo: (t: Go) => void }) {
  const L = T[lang];
  const [text, setText] = useState("");
  const voice = Boolean(sttEngine());
  return (
    <div className="h-full overflow-y-auto px-4 pb-6 pt-4" data-testid="home">
      <div className="text-center">
        <h1 className="text-2xl font-bold">{L.hello}</h1>
        <p className="mx-auto mt-1 max-w-xs text-xs text-[var(--hint)]">{L.sub}</p>
      </div>

      <div className="my-6 flex flex-col items-center gap-3">
        <button
          onClick={voice ? onTalk : () => onAsk(text || L.quick[0])}
          className="relative grid h-40 w-40 place-items-center rounded-full bg-[var(--btn)] text-[var(--btn-text)] shadow-xl active:scale-95"
          aria-label={L.talk}
          data-testid="home-talk"
        >
          <span className="absolute inset-0 animate-ping rounded-full bg-[var(--btn)] opacity-20" />
          <span className="text-6xl">🎙️</span>
        </button>
        <div className="text-sm font-semibold">{L.talk}</div>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onAsk(text.trim());
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={L.typeIt} className="min-w-0 flex-1 rounded-xl bg-[var(--card)] px-3 py-2.5 text-sm" data-testid="home-text" />
        <button className="rounded-xl bg-[var(--btn)] px-3 text-sm text-[var(--btn-text)]">{L.ask}</button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {L.quick.map((q) => (
          <button key={q} onClick={() => onAsk(q)} className="rounded-full border border-[var(--btn)] px-3 py-1 text-xs text-[var(--link)]">
            {q}
          </button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        {L.tiles.map(([id, icon, title, sub]) => (
          <button key={id} onClick={() => onGo(id)} className={`rounded-2xl p-3 text-left ${id === "firstaid" ? "bg-red-50 text-red-950" : "bg-[var(--card)]"}`} data-testid={`tile-${id}`}>
            <div className="text-2xl">{icon}</div>
            <div className="mt-1 text-sm font-semibold leading-tight">{title}</div>
            <div className="text-[11px] leading-tight text-[var(--hint)]">{sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
