import { useEffect, useRef, useState } from "react";
import { localChat } from "../lib/offline";
import { listen, speakText, stopSpeaking, sttEngine } from "../lib/voice";
import { suggestAid, routeVoice, type VoiceIntent } from "../lib/voiceRouter";
import { FIRST_AID } from "../data/firstAid";
import { loadCard, isEmptyCard } from "../lib/medcard";
import { searchMeds } from "./Medicines";
import { nearestFacilities, searchFacilities } from "../lib/facilitySearch";
import { haptic, requestLocation } from "../lib/telegram";
import type { Lang } from "../lib/i18n";
import { SpeechConsent, VOICE_ERR } from "./VoiceInput";
import { EmergencyButtons } from "./Emergency";

// Встроенный голосовой помощник. Работает офлайн: понимание фразы, поиск и ответы — на устройстве.
// Вопросы обрабатываются на устройстве: симптомы и голосовой текст не отправляются на сервер.

export type Nav = {
  tab: "home" | "firstaid" | "meds" | "map" | "book" | "tickets" | "sos" | "chat" | "scanner" | "offline" | "dmed";
  query?: string;
  aidId?: string;
  pharmacy?: boolean;
  near?: boolean;
  openNow?: boolean;
};

const T = {
  ru: {
    title: "Голосовой помощник",
    hint: "Скажите или нажмите, например:",
    examples: ["Обжёгся кипятком, что делать?", "Ближайшая поликлиника", "Бесплатные лекарства от давления", "Что ты умеешь?"],
    listening: "Слушаю…",
    thinking: "Думаю…",
    tap: "Нажмите, чтобы говорить",
    again: "Спросить ещё",
    typed: "Или напишите вопрос",
    send: "Спросить",
    stopTalk: "⏹ Остановить озвучку",
    offline: "работает без интернета",
    meds: (n: number, names: string) => (n ? `Нашла бесплатных лекарств: ${n}. Например: ${names}. Список открыт на экране.` : "В перечне бесплатных лекарств ничего не нашла. Назовите болезнь или лекарство иначе."),
    fac: (n: number, name: string, addr: string) => (n ? `Нашла учреждений: ${n}. Первое: ${name}. Адрес: ${addr}.` : "В справочнике Ташкента ничего не нашла. Назовите район или специальность."),
    near: (name: string, addr: string, km: number) => `Ближайшее: ${name}, примерно ${km < 1 ? `${Math.max(10, Math.round(km * 100) * 10)} метров` : `${km.toFixed(1).replace(".", ",")} километра`}. Адрес: ${addr}. Список открыт по расстоянию.`,
    nearNoGps: "Не удалось определить местоположение. Открыла справочник — выберите район.",
    nearNoCoords: "Координаты учреждений ещё не загружены — нужен один запуск с интернетом. Пока открыла справочник по районам.",
    aid: (title: string, urgent: boolean, steps: string[]) => `${urgent ? "Сначала звоните 103. " : ""}${title}. ${steps.slice(0, 3).map((s, i) => `${i + 1}. ${s}`).join(" ")} Остальные шаги — на экране.`,
    call: "Открываю набор номера 103. Нажмите кнопку вызова.",
    pharmacy: "Открываю карту аптек рядом.",
    pharmacyOpen: "Показываю аптеки рядом, которые открыты сейчас. Часы работы — по данным OpenStreetMap, лучше уточнить по телефону.",
    book: "Открываю запись к врачу.",
    tickets: "Открываю ваши талоны.",
    sos: "Открываю SOS: можно отправить близким, где вы, и данные медкарты.",
    medcard: (txt: string) => (txt ? `Ваша медкарта: ${txt}.` : "Медкарта пока не заполнена. Открыла её — заполните, это займёт минуту."),
    scanner: "Открываю сканер рецептов и анализов. Сфотографируйте документ.",
    offlineReady: "Открываю офлайн-готовность: здесь видно, что работает без интернета.",
    dmed: "Открываю DMED: поликлиника прикрепления, электронные рецепты и записи.",
    lang: "Переключаю на русский.",
    help: "Я умею: подсказать первую помощь, найти ближайшую поликлинику или больницу Ташкента, найти бесплатные лекарства, открыть запись к врачу, сканер рецептов, медкарту и SOS, вызвать скорую. Просто скажите, что нужно.",
  },
  uz: {
    title: "Ovozli yordamchi",
    hint: "Ayting yoki bosing, masalan:",
    examples: ["Qaynoq suvdan kuydi, nima qilish kerak?", "Eng yaqin poliklinika", "Bosim uchun bepul dorilar", "Nima qila olasan?"],
    listening: "Tinglayapman…",
    thinking: "O‘ylayapman…",
    tap: "Gapirish uchun bosing",
    again: "Yana so‘rash",
    typed: "Yoki savolni yozing",
    send: "So‘rash",
    stopTalk: "⏹ Ovozni to‘xtatish",
    offline: "internetsiz ishlaydi",
    meds: (n: number, names: string) => (n ? `Bepul dorilar topildi: ${n} ta. Masalan: ${names}. Ro‘yxat ekranda ochildi.` : "Bepul dorilar ro‘yxatida topilmadi. Kasallik yoki dori nomini boshqacha ayting."),
    fac: (n: number, name: string, addr: string) => (n ? `Muassasalar topildi: ${n} ta. Birinchisi: ${name}. Manzil: ${addr}.` : "Toshkent ma’lumotnomasida topilmadi. Tuman yoki mutaxassislikni ayting."),
    near: (name: string, addr: string, km: number) => `Eng yaqini: ${name}, taxminan ${km < 1 ? `${Math.max(10, Math.round(km * 100) * 10)} metr` : `${km.toFixed(1)} kilometr`}. Manzil: ${addr}. Ro‘yxat masofa bo‘yicha ochildi.`,
    nearNoGps: "Joylashuvni aniqlab bo‘lmadi. Ma’lumotnomani ochdim — tumanni tanlang.",
    nearNoCoords: "Muassasalar koordinatalari hali yuklanmagan — bir marta internet bilan ishga tushirish kerak. Hozircha tumanlar bo‘yicha ochdim.",
    aid: (title: string, urgent: boolean, steps: string[]) => `${urgent ? "Avval 103 ga qo‘ng‘iroq qiling. " : ""}${title}. ${steps.slice(0, 3).map((s, i) => `${i + 1}. ${s}`).join(" ")} Qolgan qadamlar ekranda.`,
    call: "103 raqamini teryapman. Qo‘ng‘iroq tugmasini bosing.",
    pharmacy: "Yaqin dorixonalar xaritasini ochyapman.",
    pharmacyOpen: "Hozir ochiq bo‘lgan yaqin dorixonalarni ko‘rsatyapman. Ish vaqti — OpenStreetMap ma’lumotlari, telefon orqali aniqlang.",
    book: "Shifokorga yozilishni ochyapman.",
    tickets: "Talonlaringizni ochyapman.",
    sos: "SOS ni ochyapman: yaqinlaringizga joylashuvingiz va tibbiy kartangizni yuborish mumkin.",
    medcard: (txt: string) => (txt ? `Tibbiy kartangiz: ${txt}.` : "Tibbiy karta hali to‘ldirilmagan. Ochdim — to‘ldiring, bir daqiqa oladi."),
    scanner: "Retsept va tahlillar skanerini ochyapman. Hujjatni suratga oling.",
    offlineReady: "Oflayn tayyorlikni ochyapman: internetsiz nima ishlashini shu yerda ko‘rasiz.",
    dmed: "DMED’ni ochyapman: biriktirilgan poliklinika, elektron retseptlar va yozilishlar.",
    lang: "O‘zbek tiliga o‘tyapman.",
    help: "Men: birinchi yordamni aytaman, Toshkentdagi eng yaqin poliklinika yoki shifoxonani topaman, bepul dorilarni topaman, shifokorga yozilish, retsept skaneri, tibbiy karta va SOS ni ochaman, tez yordam chaqiraman. Nima kerakligini ayting.",
  },
};

type State = "idle" | "listening" | "thinking" | "answer";

export function VoiceAssistant({
  lang,
  onClose,
  onNavigate,
  onSetLang,
  autoListen,
  initialText,
}: {
  lang: Lang;
  onClose: () => void;
  onNavigate: (n: Nav) => void;
  onSetLang: (l: Lang) => void;
  autoListen?: boolean;
  initialText?: string;
}) {
  const L = T[lang];
  const [state, setState] = useState<State>("idle");
  const [heard, setHeard] = useState("");
  const [answer, setAnswer] = useState("");
  const [emergency, setEmergency] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  // Слабое совпадение с инструкцией первой помощи — не открываем сами, а предлагаем.
  const [suggest, setSuggest] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const canListen = Boolean(sttEngine());
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initialText) void handle(initialText);
    else if (autoListen && canListen) start();
    return () => {
      stopRef.current?.();
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function say(raw: string, sayLang: Lang = lang) {
    const text = raw.replace(/\s*\[[\w-]{1,20}\]/g, ""); // служебные метки источников не показываем и не читаем
    setAnswer(text);
    setState("answer");
    setSpeaking(true);
    await speakText(text, sayLang);
    setSpeaking(false);
  }

  async function handle(text: string) {
    setSuggest(null);
    setHeard(text);
    setErr(null);
    setEmergency(false);
    setState("thinking");
    const intent: VoiceIntent = routeVoice(text);
    switch (intent.kind) {
      case "firstaid": {
        const g = FIRST_AID.find((x) => x.id === intent.id)!;
        setEmergency(intent.urgent);
        onNavigate({ tab: "firstaid", aidId: g.id });
        return say(L.aid(g[lang].title, intent.urgent, g[lang].steps));
      }
      case "emergency":
        setEmergency(true);
        onNavigate({ tab: "firstaid" });
        return say(localChat([{ role: "user", text }], lang).answer);
      case "call":
        setEmergency(true);
        void say(L.call);
        window.location.href = `tel:${intent.number}`;
        return;
      case "meds": {
        const hits = searchMeds(intent.query);
        onNavigate({ tab: "meds", query: intent.query });
        return say(L.meds(hits.length, hits.slice(0, 3).map((h) => (lang === "uz" ? h.item.uz : h.item.ru)).join(", ")));
      }
      case "facility": {
        if (intent.near) {
          let pos: { lat: number; lon: number } | null = null;
          try {
            pos = await Promise.race([requestLocation(), new Promise<never>((_, r) => setTimeout(() => r("t"), 12000))]);
          } catch {
            pos = null;
          }
          onNavigate({ tab: "map", near: true, query: "" });
          if (!pos) return say(L.nearNoGps);
          const near = nearestFacilities(pos, intent.query);
          if (!near.length) return say(L.nearNoCoords);
          const f = near[0];
          return say(L.near(lang === "uz" ? f.item.uz : f.item.ru, f.item.address, f.km));
        }
        const hits = searchFacilities(intent.query);
        if (!hits.length) break; // не нашли — ответит помощник
        onNavigate({ tab: "map", query: intent.query });
        const f = hits[0].item;
        return say(L.fac(hits.length, lang === "uz" ? f.uz : f.ru, f.address));
      }
      case "pharmacy":
        onNavigate({ tab: "map", pharmacy: true, openNow: intent.openNow });
        return say(intent.openNow ? L.pharmacyOpen : L.pharmacy);
      case "book":
      case "tickets":
      case "sos":
      case "scanner":
        onNavigate({ tab: intent.kind });
        return say(L[intent.kind]);
      case "offline":
        onNavigate({ tab: "offline" });
        return say(L.offlineReady);
      case "dmed":
        onNavigate({ tab: "dmed" });
        return say(L.dmed);
      case "medcard": {
        const c = loadCard();
        onNavigate({ tab: "sos" });
        const parts = isEmptyCard(c) ? "" : (lang === "uz"
              ? [c.name, c.bloodType && `qon guruhi ${c.bloodType}`, c.allergies && `allergiya: ${c.allergies}`, c.medications && `dorilar: ${c.medications}`]
              : [c.name, c.bloodType && `группа крови ${c.bloodType}`, c.allergies && `аллергия: ${c.allergies}`, c.medications && `лекарства: ${c.medications}`]).filter(Boolean).join(", ");
        return say(L.medcard(parts));
      }
      case "lang":
        onSetLang(intent.lang);
        return say(T[intent.lang].lang, intent.lang);
      case "help":
        return say(L.help);
    }
    // Локальный триаж и база источников — без отправки текста симптомов на сервер.
    const r = localChat([{ role: "user", text }], lang);
    setEmergency(r.emergency);
    const maybe = suggestAid(text);
    if (maybe && !r.emergency) {
      setSuggest(maybe.id);
      return say(lang === "uz" ? `Bu «${maybe.uz.title}» ga o‘xshaydi. Yo‘riqnomani ochish uchun tugmani bosing.` : `Похоже на «${maybe.ru.title}». Нажмите кнопку, чтобы открыть инструкцию.`);
    }
    await say(r.answer);
  }

  function start() {
    haptic();
    stopSpeaking();
    setSpeaking(false);
    setErr(null);
    setSuggest(null);
    setHeard("");
    setAnswer("");
    setState("listening");
    stopRef.current = listen(lang, {
      onPartial: setHeard,
      onResult: (t) => void handle(t),
      onError: (c) => {
        setState("idle");
        if (c === "consent") return setConsent(true);
        setErr(VOICE_ERR[lang][c]);
      },
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose} role="dialog" aria-label={L.title}>
      <div className="max-h-[88%] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-[var(--bg)] p-4 pb-6" onClick={(e) => e.stopPropagation()} data-testid="voice-assistant">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">
            🎙️ {L.title} <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">{L.offline}</span>
          </h2>
          <button onClick={onClose} className="px-2 text-lg" aria-label="✕">
            ✕
          </button>
        </div>

        {canListen && (
          <div className="flex flex-col items-center gap-2 py-2">
            <button
              onClick={() => (state === "listening" ? stopRef.current?.() : start())}
              className={`grid h-20 w-20 place-items-center rounded-full text-3xl text-white shadow-lg ${state === "listening" ? "animate-pulse bg-red-600" : "bg-[var(--btn)]"}`}
              aria-label={L.tap}
              data-testid="va-mic"
            >
              {state === "listening" ? "■" : "🎤"}
            </button>
            <div className="text-xs text-[var(--hint)]">{state === "listening" ? L.listening : state === "thinking" ? L.thinking : state === "answer" ? L.again : L.tap}</div>
          </div>
        )}

        {heard && <p className="mt-2 rounded-2xl bg-[var(--card)] p-3 text-sm italic">«{heard}»</p>}
        {answer && (
          <div className={`mt-2 whitespace-pre-line rounded-2xl p-3 text-sm ${emergency ? "border border-red-300 bg-red-50 text-red-900" : "bg-emerald-50 text-emerald-950"}`} data-testid="va-answer">
            {answer}
            {emergency && <EmergencyButtons lang={lang} className="mt-2" />}
            {suggest && (() => {
              const g = FIRST_AID.find((x) => x.id === suggest);
              return g ? (
                <button onClick={() => { setSuggest(null); stopSpeaking(); onNavigate({ tab: "firstaid", aidId: g.id }); onClose(); }} className="mt-2 w-full rounded-xl bg-red-600 py-2 text-sm font-medium text-white" data-testid="aid-suggest">
                  {g.icon} {lang === "uz" ? g.uz.title : g.ru.title} — {lang === "uz" ? "ochish" : "открыть"}
                </button>
              ) : null;
            })()}
          </div>
        )}
        {speaking && (
          <button
            onClick={() => {
              stopSpeaking();
              setSpeaking(false);
            }}
            className="mt-2 w-full rounded-xl bg-[var(--card)] py-2 text-xs"
          >
            {L.stopTalk}
          </button>
        )}
        {err && <p className="mt-2 rounded-xl bg-amber-50 p-2 text-xs text-amber-900">{err}</p>}
        {consent && (
          <div className="mt-2">
            <SpeechConsent
              lang={lang}
              onAllow={() => {
                setConsent(false);
                start();
              }}
              onClose={() => setConsent(false)}
            />
          </div>
        )}

        {state === "idle" && !heard && (
          <div className="mt-2">
            <div className="text-xs text-[var(--hint)]">{L.hint}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {L.examples.map((x) => (
                <button key={x} onClick={() => void handle(x)} className="rounded-full border border-[var(--btn)] px-3 py-1 text-xs text-[var(--link)]">
                  {x}
                </button>
              ))}
            </div>
          </div>
        )}

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) {
              void handle(typed.trim());
              setTyped("");
            }
          }}
        >
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={L.typed} className="min-w-0 flex-1 rounded-xl bg-[var(--card)] px-3 py-2 text-sm" data-testid="va-text" />
          <button className="rounded-xl bg-[var(--btn)] px-3 text-sm text-[var(--btn-text)]">{L.send}</button>
        </form>
      </div>
    </div>
  );
}
