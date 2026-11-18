// Голос без сервера: распознавание речи и озвучка.
// 1) Android-приложение BepulMed — системные SpeechRecognizer и TextToSpeech через мост window.BepulMedNative;
// 2) браузер с Web Speech API (Chrome) — SpeechRecognition и speechSynthesis;
// 3) иначе — серверный VoiceLab (компонент VoiceButton), если сервер подключён.
import { onNativeHttp } from "./dmed";

type Lang = "ru" | "uz";

interface NativeBridge {
  clearTileCache?(): void;
  startListening(lang: string): void;
  stopListening(): void;
  speak(text: string, lang: string): void;
  stopSpeaking(): void;
  capabilities(): string;
  geocode?(id: string, query: string): void;
  setNetworkSpeech?(allow: boolean): void;
  openSpeechSettings?(): void;
}

interface NativeEvent {
  type: "ready" | "partial" | "result" | "error" | "end" | "tts_start" | "tts_done" | "geo";
  text?: string;
  code?: string;
  id?: string;
  lat?: number;
  lon?: number;
}

declare global {
  interface Window {
    BepulMedNative?: NativeBridge;
    __bmVoice?: (e: NativeEvent | string) => void;
    SpeechRecognition?: new () => WebRecognition;
    webkitSpeechRecognition?: new () => WebRecognition;
  }
}

interface WebRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}


export type VoiceErrorCode = "denied" | "no_speech" | "unsupported" | "network" | "busy" | "consent" | "other";

export interface ListenHandlers {
  onPartial?: (text: string) => void;
  onResult: (text: string) => void;
  onError?: (code: VoiceErrorCode) => void;
  onEnd?: () => void;
}

const native = () => (typeof window !== "undefined" ? window.BepulMedNative : undefined);
const WebRec = () => (typeof window !== "undefined" ? window.SpeechRecognition ?? window.webkitSpeechRecognition : undefined);

export interface NativeCaps {
  stt: boolean;
  sttOnDevice: boolean;
  sttNetwork: boolean;
  netSpeechAllowed: boolean;
  tts: boolean;
  ttsUz: boolean;
  /** Android и iOS-приложение: число и объём сохранённых тайлов карты. */
  tiles?: number;
  tileBytes?: number;
  online?: boolean;
}
const NO_CAPS: NativeCaps = { stt: false, sttOnDevice: false, sttNetwork: false, netSpeechAllowed: false, tts: false, ttsUz: false };

export function nativeCaps(): NativeCaps {
  try {
    const n = native();
    return n ? { ...NO_CAPS, ...JSON.parse(n.capabilities()) } : NO_CAPS;
  } catch {
    return NO_CAPS;
  }
}

/** Пользователь разрешил/запретил сетевое распознавание (Android и iOS-приложение). */
export function setNetworkSpeech(allow: boolean): void {
  native()?.setNetworkSpeech?.(allow);
}

export function openSpeechSettings(): void {
  native()?.openSpeechSettings?.();
}

/** Какой движок распознавания доступен на этом устройстве без сервера. */
export function sttEngine(): "native" | "web" | null {
  // Web Speech API may forward audio to a browser/vendor service. For medical speech
  // keep input strictly on-device; only the Android native bridge is enabled.
  // Кнопка микрофона есть, если распознавание на устройстве ИЛИ сетевое (тогда сначала спросим согласие).
  if (native()) {
    const c = nativeCaps();
    if (c.stt || c.sttOnDevice || c.sttNetwork) return "native";
  }
  return null;
}

export function ttsEngine(): "native" | "web" | null {
  if (native() && nativeCaps().tts) return "native";
  if (typeof window !== "undefined" && "speechSynthesis" in window) return "web";
  return null;
}

// --- события от Android ---
let nativeHandlers: ListenHandlers | null = null;
let ttsDone: (() => void) | null = null;

function mapCode(code?: string): VoiceErrorCode {
  if (code === "denied" || code === "not-allowed" || code === "service-not-allowed") return "denied";
  if (code === "no_speech" || code === "no-speech" || code === "no_match") return "no_speech";
  if (code === "network" || code === "network-timeout") return "network";
  if (code === "busy") return "busy";
  if (code === "unsupported") return "unsupported";
  if (code === "consent_required") return "consent";
  return "other";
}

if (typeof window !== "undefined") {
  window.__bmVoice = (raw) => {
    let e: NativeEvent;
    try {
      e = typeof raw === "string" ? (JSON.parse(raw) as NativeEvent) : raw;
    } catch {
      return;
    }
    if (e.type === "geo") {
      window.dispatchEvent(new CustomEvent("bm-geo", { detail: e }));
      return;
    }
    if ((e.type as string) === "http") {
      onNativeHttp(e as unknown as { id?: string; status?: number; body?: string });
      return;
    }
    const h = nativeHandlers;
    if (e.type === "partial" && e.text) h?.onPartial?.(e.text);
    else if (e.type === "result") {
      nativeHandlers = null;
      if (e.text) h?.onResult(e.text);
      else h?.onError?.("no_speech");
      h?.onEnd?.();
    } else if (e.type === "error") {
      nativeHandlers = null;
      h?.onError?.(mapCode(e.code));
      h?.onEnd?.();
    } else if (e.type === "tts_done") {
      const d = ttsDone;
      ttsDone = null;
      d?.();
    }
  };
}

const LOCALE: Record<Lang, string> = { ru: "ru-RU", uz: "uz-UZ" };

/** Начать слушать. Возвращает функцию «стоп». */
export function listen(lang: Lang, h: ListenHandlers): () => void {
  const engine = sttEngine();
  if (engine === "native") {
    nativeHandlers = h;
    native()!.startListening(LOCALE[lang]);
    return () => native()?.stopListening();
  }
  if (engine === "web") {
    const R = WebRec()!;
    const r = new R();
    r.lang = LOCALE[lang];
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.continuous = false;
    let final = "";
    let done = false;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (interim) h.onPartial?.(final + interim);
    };
    r.onerror = (e) => {
      if (done) return;
      done = true;
      h.onError?.(mapCode(e.error));
      h.onEnd?.();
    };
    r.onend = () => {
      if (done) return;
      done = true;
      if (final.trim()) h.onResult(final.trim());
      else h.onError?.("no_speech");
      h.onEnd?.();
    };
    try {
      r.start();
    } catch {
      done = true;
      h.onError?.("busy");
      h.onEnd?.();
    }
    return () => r.stop();
  }
  h.onError?.("unsupported");
  h.onEnd?.();
  return () => undefined;
}

/** Озвучить текст. Узбекский голос есть не на всех телефонах — тогда читает русским (сообщаем через результат). */
export function speakText(text: string, lang: Lang): Promise<"spoken" | "unsupported"> {
  const clean = text.replace(/\[[\w-]{1,20}\]/g, "").replace(/https?:\/\/\S+/g, "").slice(0, 1200);
  const engine = ttsEngine();
  if (engine === "native") {
    return new Promise((resolve) => {
      ttsDone = () => resolve("spoken");
      native()!.speak(clean, LOCALE[lang]);
      setTimeout(() => {
        if (ttsDone) {
          ttsDone = null;
          resolve("spoken");
        }
      }, 120000);
    });
  }
  if (engine === "web") {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = LOCALE[lang];
      const v = speechSynthesis.getVoices().find((x) => x.lang.toLowerCase().startsWith(lang));
      if (v) u.voice = v;
      u.onend = () => resolve("spoken");
      u.onerror = () => resolve("spoken");
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }
  return Promise.resolve("unsupported");
}

export function stopSpeaking(): void {
  try {
    native()?.stopSpeaking();
    if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
  } catch {
    /* нет озвучки */
  }
}

/** Очистить офлайн-кэш карты (Android и iOS-приложение). */
export function clearTileCache(): void {
  native()?.clearTileCache?.();
}

export const isNativeApp = (): boolean => !!native();

/** Чей сервис распознаёт речь, если на устройстве нет офлайн-пакета: Google (Android) или Apple (iOS). */
export const speechVendor = (): "Google" | "Apple" => (typeof navigator !== "undefined" && /BepulMedIOS\//.test(navigator.userAgent) ? "Apple" : "Google");
