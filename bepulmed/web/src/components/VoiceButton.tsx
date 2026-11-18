import { useEffect, useRef, useState } from "react";
import { ApiError, transcribe } from "../lib/api";
import { t, type Lang } from "../lib/i18n";
import { haptic } from "../lib/telegram";

const MAX_SECONDS = 30;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return undefined;
}

/**
 * Запись голосового сообщения по кнопке (не непрерывный диалог) → VoiceLab STT.
 * Распознанный текст НЕ отправляется автоматически: пациент видит его в поле ввода и может исправить.
 */
export function VoiceButton({ lang, onText, onError }: { lang: Lang; onText: (t: string) => void; onError: (msg: string) => void }) {
  const L = t(lang);
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      rec.current?.stream.getTracks().forEach((tr) => tr.stop());
    },
    [],
  );

  async function start() {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return onError(L.micUnsupported);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return onError(L.micDenied);
    }
    const mime = pickMime();
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      if (timer.current) clearInterval(timer.current);
      const blob = new Blob(chunks, { type: r.mimeType || mime || "audio/webm" });
      if (blob.size < 1000) return setState("idle"); // слишком короткая запись
      setState("busy");
      try {
        // «auto» — язык определяет VoiceLab; смешанная речь распознаётся менее надёжно, поэтому текст проверяет человек.
        const text = await transcribe(blob, "auto");
        if (text) onText(text);
      } catch (e) {
        const code = e instanceof ApiError ? e.code : "network";
        onError(code === "voice_unavailable" || code.startsWith("voicelab") ? L.voiceUnavailable : L.errNetwork);
      } finally {
        setState("idle");
      }
    };
    rec.current = r;
    r.start();
    haptic();
    setSecs(0);
    setState("rec");
    timer.current = setInterval(() => {
      setSecs((s) => {
        if (s + 1 >= MAX_SECONDS && r.state === "recording") r.stop();
        return s + 1;
      });
    }, 1000);
  }

  function stop() {
    if (rec.current?.state === "recording") rec.current.stop();
  }

  return (
    <button
      type="button"
      onClick={state === "rec" ? stop : state === "idle" ? start : undefined}
      disabled={state === "busy"}
      aria-label={state === "rec" ? L.micStop : L.micStart}
      className={`shrink-0 rounded-xl px-3 text-sm ${state === "rec" ? "animate-pulse bg-red-600 text-white" : "bg-[var(--card)]"} disabled:opacity-50`}
    >
      {state === "rec" ? `■ ${secs}s` : state === "busy" ? "…" : "🎤"}
    </button>
  );
}
