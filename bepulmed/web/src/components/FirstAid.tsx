import { useEffect, useMemo, useRef, useState } from "react";
import { AID_SOURCES, EMERGENCY_NUMBERS, FIRST_AID, type AidGuide } from "../data/firstAid";
import { search } from "../lib/search";
import { speakText, stopSpeaking, ttsEngine } from "../lib/voice";
import { openLink } from "../lib/telegram";
import type { Lang } from "../lib/i18n";
import { VoiceInput } from "./VoiceInput";

// «Скорая помощь»: первая помощь до приезда врачей — полностью офлайн.

export function searchAid(query: string) {
  return search(FIRST_AID, query, (g) => [
    { text: g.ru.title, weight: 1 },
    { text: g.uz.title, weight: 1 },
    { text: g.keys.join(" "), weight: 0.95 },
    { text: `${g.ru.steps.join(" ")} ${g.uz.steps.join(" ")}`, weight: 0.35 },
  ]);
}

const T = {
  ru: {
    title: "Скорая помощь — первая помощь",
    sub: "Работает без интернета. Опишите, что случилось:",
    ph: "Например: «ожог кипятком», «подавился», «не дышит»",
    found: "Подходящие инструкции",
    none: "Не нашёл. Опишите иначе или выберите из списка ниже. При угрозе жизни — звоните 103.",
    all: "Все ситуации",
    main: "Самое важное",
    do: "Что делать",
    dont: "Нельзя",
    call: "Когда звонить",
    call103: "📞 Позвонить 103",
    read: "🔊 Прочитать вслух",
    stop: "⏹ Стоп",
    back: "← Все ситуации",
    urgent: "СРОЧНО 103",
    metro: "Метроном для нажатий (110 в минуту)",
    metroOn: "▶ Включить метроном",
    metroOff: "⏹ Остановить",
    count: "Нажатий",
    disclaimer: "Инструкции основаны на рекомендациях Красного Креста (IFRC 2020) и Европейского совета по реанимации (ERC). Это не заменяет врача — при угрозе жизни сначала звоните 103.",
    sources: "Источники",
  },
  uz: {
    title: "Tez yordam — birinchi yordam",
    sub: "Internetsiz ishlaydi. Nima bo‘lganini yozing:",
    ph: "Masalan: «qaynoq suvdan kuydi», «tiqilib qoldi», «nafas olmayapti»",
    found: "Mos yo‘riqnomalar",
    none: "Topilmadi. Boshqacha yozing yoki pastdagi ro‘yxatdan tanlang. Hayotga xavf bo‘lsa — 103.",
    all: "Barcha holatlar",
    main: "Eng muhimi",
    do: "Nima qilish kerak",
    dont: "Mumkin emas",
    call: "Qachon qo‘ng‘iroq qilish kerak",
    call103: "📞 103 ga qo‘ng‘iroq",
    read: "🔊 Ovoz chiqarib o‘qish",
    stop: "⏹ To‘xtatish",
    back: "← Barcha holatlar",
    urgent: "SHOSHILINCH 103",
    metro: "Bosish uchun metronom (daqiqasiga 110)",
    metroOn: "▶ Metronomni yoqish",
    metroOff: "⏹ To‘xtatish",
    count: "Bosishlar",
    disclaimer: "Yo‘riqnomalar Qizil Xoch (IFRC 2020) va Yevropa reanimatsiya kengashi (ERC) tavsiyalariga asoslangan. Bu shifokorni almashtirmaydi — hayotga xavf bo‘lsa, avval 103 ga qo‘ng‘iroq qiling.",
    sources: "Manbalar",
  },
};

const MAIN = ["cpr", "bleeding", "choking", "heart_attack", "stroke", "burn"];

/** Метроном 110 ударов/мин (WebAudio, без сети), счёт до 30. */
function CprMetronome({ lang }: { lang: Lang }) {
  const L = T[lang];
  const [on, setOn] = useState(false);
  const [n, setN] = useState(0);
  const ctx = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!on) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx.current ??= AC ? new AC() : null;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setN(((i - 1) % 30) + 1);
      const c = ctx.current;
      if (!c) return;
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = i % 30 === 0 ? 1320 : 880;
      g.gain.setValueAtTime(0.4, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.08);
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + 0.09);
    }, 60000 / 110);
    return () => clearInterval(id);
  }, [on]);
  return (
    <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-3 text-red-950" data-testid="cpr-metronome">
      <div className="font-semibold">⏱️ {L.metro}</div>
      <div className="mt-2 flex items-center gap-3">
        <button onClick={() => setOn((v) => !v)} className={`flex-1 rounded-xl py-3 font-semibold text-white ${on ? "bg-gray-700" : "bg-red-600"}`}>
          {on ? L.metroOff : L.metroOn}
        </button>
        <div className={`grid h-14 w-14 place-items-center rounded-full text-xl font-bold tabular-nums ${on ? "animate-pulse bg-red-600 text-white" : "bg-white"}`}>{on ? n : "30"}</div>
      </div>
      <div className="mt-1 text-[11px]">{L.count}: 30 → 2 вдоха / 2 ta nafas</div>
    </div>
  );
}

export function GuideView({ g, lang, onBack }: { g: AidGuide; lang: Lang; onBack?: () => void }) {
  const L = T[lang];
  const t = g[lang];
  const [reading, setReading] = useState(false);
  useEffect(() => () => stopSpeaking(), []);
  async function read() {
    if (reading) {
      stopSpeaking();
      setReading(false);
      return;
    }
    setReading(true);
    await speakText(`${t.title}. ${t.steps.map((s, i) => `${i + 1}. ${s}`).join(" ")}`, lang);
    setReading(false);
  }
  return (
    <div className="space-y-3" data-testid="aid-guide">
      {onBack && (
        <button onClick={onBack} className="text-xs text-[var(--link)] underline">
          {L.back}
        </button>
      )}
      <h2 className="text-lg font-bold leading-snug">
        {g.icon} {t.title}
      </h2>
      {g.urgent && (
        <a href="tel:103" className="block rounded-2xl bg-red-600 py-4 text-center text-lg font-bold text-white" data-testid="aid-call">
          {L.call103}
        </a>
      )}
      {ttsEngine() && (
        <button onClick={read} className="w-full rounded-xl bg-[var(--card)] py-2 text-sm">
          {reading ? L.stop : L.read}
        </button>
      )}
      <div className="rounded-2xl bg-[var(--card)] p-3">
        <div className="mb-1 font-semibold">✅ {L.do}</div>
        <ol className="list-decimal space-y-2 pl-5 text-[15px] leading-snug">
          {t.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
      {g.cpr && <CprMetronome lang={lang} />}
      {t.dont?.length ? (
        <div className="rounded-2xl bg-amber-50 p-3 text-amber-950">
          <div className="mb-1 font-semibold">⛔ {L.dont}</div>
          <ul className="list-disc space-y-1 pl-5">
            {t.dont.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="rounded-2xl bg-red-50 p-3 text-red-900">
        <div className="mb-1 font-semibold">📞 {L.call}</div>
        <p>{t.call}</p>
        {!g.urgent && (
          <a href="tel:103" className="mt-2 block rounded-xl bg-red-600 py-2 text-center font-semibold text-white">
            {L.call103}
          </a>
        )}
      </div>
    </div>
  );
}

export function FirstAid({ lang, open }: { lang: Lang; open?: { id?: string; query?: string; n: number } }) {
  const L = T[lang];
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<AidGuide | null>(null);

  // Открыто голосовым помощником: конкретная инструкция или поиск.
  useEffect(() => {
    if (!open) return;
    if (open.id) setSel(FIRST_AID.find((g) => g.id === open.id) ?? null);
    else if (open.query) {
      setSel(null);
      setQ(open.query);
    }
  }, [open]);

  const hits = useMemo(() => (q.trim() ? searchAid(q) : null), [q]);
  const main = FIRST_AID.filter((g) => MAIN.includes(g.id));

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3 text-sm" data-testid="first-aid">
      {sel ? (
        <GuideView g={sel} lang={lang} onBack={() => setSel(null)} />
      ) : (
        <>
          <div>
            <h2 className="text-base font-semibold text-red-700">🚑 {L.title}</h2>
            <p className="text-xs text-[var(--hint)]">{L.sub}</p>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {EMERGENCY_NUMBERS.map((e) => (
              <a key={e.n} href={`tel:${e.n}`} className={`rounded-xl py-2 text-center ${e.n === "103" ? "bg-red-600 text-white" : "bg-red-50 text-red-800"}`}>
                <div className="text-lg font-bold leading-none">{e.n}</div>
                <div className="text-[10px]">{lang === "uz" ? e.uz : e.ru}</div>
              </a>
            ))}
          </div>
          <div className="sticky top-0 z-10 -mx-3 bg-[var(--bg)] px-3 py-1">
            <div className="flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L.ph} maxLength={100} className="min-w-0 flex-1 rounded-xl border-2 border-red-300 bg-[var(--card)] px-3 py-2.5 outline-none" aria-label={L.ph} data-testid="aid-search" />
              <VoiceInput lang={lang} onText={setQ} />
            </div>
          </div>
          {hits && (
            <>
              <div className="text-xs font-semibold text-[var(--hint)]">{L.found}</div>
              {hits.length === 0 && <p className="rounded-xl bg-amber-50 p-3 text-amber-900">{L.none}</p>}
              {hits.slice(0, 5).map((h) => (
                <AidTile key={h.item.id} g={h.item} lang={lang} onOpen={setSel} />
              ))}
            </>
          )}
          {!hits && (
            <>
              <div className="text-xs font-semibold text-[var(--hint)]">{L.main}</div>
              <div className="grid grid-cols-2 gap-2">
                {main.map((g) => (
                  <button key={g.id} onClick={() => setSel(g)} className="rounded-2xl bg-red-50 p-3 text-left text-red-950">
                    <div className="text-2xl">{g.icon}</div>
                    <div className="mt-1 text-xs font-semibold leading-tight">{g[lang].title}</div>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="pt-1 text-xs font-semibold text-[var(--hint)]">{L.all}</div>
          <div className="space-y-1.5">
            {FIRST_AID.map((g) => (
              <AidTile key={g.id} g={g} lang={lang} onOpen={setSel} compact />
            ))}
          </div>
          <p className="text-[11px] text-[var(--hint)]">ℹ️ {L.disclaimer}</p>
          <div className="text-[11px]">
            {L.sources}:{" "}
            {AID_SOURCES.map((s) => (
              <button key={s.url} onClick={() => openLink(s.url)} className="mr-2 text-[var(--link)] underline">
                {s.title}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AidTile({ g, lang, onOpen, compact }: { g: AidGuide; lang: Lang; onOpen: (g: AidGuide) => void; compact?: boolean }) {
  const L = T[lang];
  return (
    <button onClick={() => onOpen(g)} className={`flex w-full items-center gap-3 rounded-2xl bg-[var(--card)] text-left ${compact ? "p-2" : "p-3"}`} data-testid="aid-tile">
      <span className="text-2xl">{g.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium leading-snug">{g[lang].title}</span>
        {!compact && <span className="block truncate text-xs text-[var(--hint)]">{g[lang].steps[0]}</span>}
      </span>
      {g.urgent && <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold text-white">{L.urgent}</span>}
    </button>
  );
}
