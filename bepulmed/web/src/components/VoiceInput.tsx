import { useEffect, useRef, useState } from "react";
import { listen, openSpeechSettings, setNetworkSpeech, sttEngine, type VoiceErrorCode, speechVendor } from "../lib/voice";
import { haptic } from "../lib/telegram";
import type { Lang } from "../lib/i18n";

// Кнопка-микрофон для поля поиска: сказал → текст попал в поле. Работает на устройстве, без сервера.

export const VOICE_ERR: Record<Lang, Record<VoiceErrorCode, string>> = {
  ru: {
    denied: "Нет доступа к микрофону. Разрешите его в настройках телефона.",
    no_speech: "Не расслышал. Нажмите и скажите ещё раз.",
    unsupported: "Распознавание речи на этом устройстве недоступно.",
    network: `Для распознавания нужен интернет (или установите офлайн-пакет языка в настройках ${speechVendor()}).`,
    busy: "Микрофон занят. Попробуйте ещё раз.",
    consent: "На телефоне нет офлайн-распознавания для этого языка.",
    other: "Не удалось распознать речь. Попробуйте ещё раз.",
  },
  uz: {
    denied: "Mikrofonga ruxsat yo‘q. Telefon sozlamalarida ruxsat bering.",
    no_speech: "Eshitmadim. Bosing va yana ayting.",
    unsupported: "Bu qurilmada nutqni tanib olish mavjud emas.",
    network: `Tanib olish uchun internet kerak (yoki ${speechVendor()} sozlamalarida til paketini o‘rnating).`,
    busy: "Mikrofon band. Yana urinib ko‘ring.",
    consent: "Telefonda bu til uchun oflayn tanib olish yo‘q.",
    other: "Nutqni tanib bo‘lmadi. Yana urinib ko‘ring.",
  },
};

/** Согласие на сетевое распознавание: по умолчанию речь не покидает телефон. */
export function SpeechConsent({ lang, onAllow, onClose }: { lang: Lang; onAllow: () => void; onClose: () => void }) {
  const ru = lang === "ru";
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950" data-testid="speech-consent">
      <p className="font-semibold">{ru ? "🔒 Голос не покидает телефон" : "🔒 Ovoz telefondan chiqmaydi"}</p>
      <p className="mt-1">
        {ru
          ? `Для этого языка на телефоне нет офлайн-распознавания. Можно скачать офлайн-пакет в настройках голосового ввода — или разрешить распознавание через сервис ${speechVendor()} (речь будет отправляться в ${speechVendor()}).`
          : `Bu til uchun telefonda oflayn tanib olish yo‘q. Ovozli kiritish sozlamalarida oflayn paketni yuklab olish mumkin — yoki ${speechVendor()} xizmati orqali tanib olishga ruxsat bering (nutq ${speechVendor()}’ga yuboriladi).`}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button onClick={() => openSpeechSettings()} className="rounded-lg bg-white px-2 py-1">
          {ru ? "⬇️ Офлайн-пакет" : "⬇️ Oflayn paket"}
        </button>
        <button
          onClick={() => {
            setNetworkSpeech(true);
            onAllow();
          }}
          className="rounded-lg bg-amber-600 px-2 py-1 text-white"
          data-testid="consent-allow"
        >
          {ru ? `Разрешить ${speechVendor()}` : `${speechVendor()}’ga ruxsat`}
        </button>
        <button onClick={onClose} className="rounded-lg px-2 py-1 underline">
          {ru ? "Нет, введу текстом" : "Yo‘q, matn bilan"}
        </button>
      </div>
    </div>
  );
}

export function VoiceInput({ lang, onText, onError }: { lang: Lang; onText: (t: string) => void; onError?: (msg: string) => void }) {
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  if (!sttEngine()) return null;

  function toggle() {
    haptic();
    if (on) {
      stop.current?.();
      return;
    }
    setErr(null);
    setOn(true);
    stop.current = listen(lang, {
      onPartial: (t) => onText(t),
      onResult: (t) => onText(t),
      onError: (c) => {
        if (c === "consent") return setConsent(true);
        const m = VOICE_ERR[lang][c];
        setErr(m);
        onError?.(m);
      },
      onEnd: () => setOn(false),
    });
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-label={lang === "uz" ? "Ovoz bilan qidirish" : "Голосовой поиск"}
        className={`grid h-full min-h-10 w-11 place-items-center rounded-xl text-lg ${on ? "animate-pulse bg-red-600 text-white" : "bg-[var(--btn)] text-[var(--btn-text)]"}`}
        data-testid="voice-input"
      >
        {on ? "■" : "🎤"}
      </button>
      {consent && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72">
          <SpeechConsent
            lang={lang}
            onAllow={() => {
              setConsent(false);
              toggle();
            }}
            onClose={() => setConsent(false)}
          />
        </div>
      )}
      {err && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900 shadow" onClick={() => setErr(null)}>
          {err}
        </div>
      )}
    </div>
  );
}
