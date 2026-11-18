import { useEffect, useRef, useState } from "react";
import { localChat } from "../lib/offline";
import { speak, type Intent, type Source, type Specialty } from "../lib/api";
import { t, type Lang } from "../lib/i18n";
import { haptic, openLink } from "../lib/telegram";
import { EmergencyButtons } from "./Emergency";
import { VoiceButton } from "./VoiceButton";
import { VoiceInput } from "./VoiceInput";
import { sttEngine } from "../lib/voice";
import { specialtyLabel } from "./Booking";

interface Msg {
  role: "user" | "assistant";
  text: string;
  sources?: Source[];
  emergency?: boolean;
  offline?: boolean;
  error?: boolean;
  intent?: Intent | null;
}

/** Убирает служебные ссылки [id] из текста — источники показываются отдельным блоком. */
export function stripCitations(s: string): string {
  return s.replace(/\s*\[[a-z0-9-]{2,20}\]/g, "").trim();
}

export function Chat({ lang, voice, onBook }: { lang: Lang; voice: boolean; onBook: (s: Specialty | null) => void }) {
  const L = t(lang);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);

  async function listen(i: number, text: string) {
    if (playing !== null) return;
    setPlaying(i);
    try {
      const blob = await speak(stripCitations(text), lang);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPlaying(null);
      };
      await audio.play();
    } catch {
      setNote(L.voiceUnavailable);
      setPlaying(null);
    }
  }
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Фигурные скобки обязательны: в новых браузерах scrollIntoView возвращает Promise,
    // а React принял бы его за функцию очистки и упал.
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    haptic();
    const next: Msg[] = [...msgs, { role: "user", text: q }];
    setMsgs(next);
    setInput("");
    setNote(null);
    setBusy(true);
    try {
      // Медицинские сообщения остаются на устройстве: триаж и база источников локальные.
      // Не отправляем симптомы, медкарту или историю чата в зарубежный Worker/LLM.
      const history = next.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
      const r = localChat(history, lang);
      setMsgs((m) => [...m, { role: "assistant", text: r.answer, sources: r.sources, emergency: r.emergency, offline: true, intent: r.intent }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="rounded-2xl bg-[var(--card)] p-3 text-sm">{L.chatHello}</div>
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {[L.quick1, L.quick2, L.quick3, L.quick4].map((q) => (
              <button key={q} onClick={() => ask(q)} className="rounded-full border border-[var(--btn)] px-3 py-1.5 text-left text-sm text-[var(--link)]">
                {q}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl bg-[var(--btn)] px-3 py-2 text-sm whitespace-pre-wrap text-[var(--btn-text)]">
              {m.text}
            </div>
          ) : (
            <div key={i} className={`max-w-[92%] rounded-2xl p-3 text-sm ${m.emergency ? "border-2 border-red-600 bg-red-50 text-red-900" : m.error ? "bg-amber-50 text-amber-900" : "bg-[var(--card)]"}`}>
              <div className="whitespace-pre-wrap">{stripCitations(m.text)}</div>
              {m.emergency && <EmergencyButtons lang={lang} className="mt-3" />}
              {m.intent && !m.emergency && (
                <button onClick={() => onBook(m.intent!.specialty)} className="mt-3 w-full rounded-xl bg-[var(--btn)] py-2 text-sm font-medium text-[var(--btn-text)]">
                  📅 {L.bookSpecialist}
                  {m.intent.specialty ? ` — ${specialtyLabel(L, m.intent.specialty)}` : ""}
                </button>
              )}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-3 border-t border-black/10 pt-2">
                  <div className="mb-1 text-xs font-semibold text-[var(--hint)]">{L.sources}</div>
                  <ul className="space-y-1">
                    {m.sources.map((s) => (
                      <li key={s.id}>
                        <button onClick={() => openLink(s.url)} className="text-left text-xs text-[var(--link)] underline">
                          {s.title}
                        </button>
                        <span className="text-[10px] text-[var(--hint)]">
                          {" "}
                          · {s.official ? L.official : L.secondary}
                          {s.checked ? ` · ${L.checked} ${s.checked}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {m.offline && <div className="mt-2 text-[10px] text-[var(--hint)]">{L.offlineMode}</div>}
              {voice && !m.error && (
                <button onClick={() => listen(i, m.text)} disabled={playing !== null} className="mt-2 text-xs text-[var(--link)] disabled:opacity-50">
                  {playing === i ? "🔊 …" : `🔊 ${L.listen}`}
                </button>
              )}
            </div>
          ),
        )}
        {busy && <div className="animate-pulse text-sm text-[var(--hint)]">{L.thinking}</div>}
        {note && <p className="rounded-xl bg-amber-50 p-2 text-xs text-amber-900">{note}</p>}
        <p className="px-1 text-[11px] text-[var(--hint)]">{L.disclaimer}</p>
        <div ref={endRef} />
      </div>
      <form
        className="flex gap-2 border-t border-black/10 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        {sttEngine() ? (
          <VoiceInput lang={lang} onText={setInput} onError={(m) => setNote(m)} />
        ) : voice && (
          <VoiceButton
            lang={lang}
            onText={(text) => {
              setInput(text);
              setNote(L.micHeard);
            }}
            onError={setNote}
          />
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={1000}
          placeholder={L.chatPlaceholder}
          className="min-w-0 flex-1 rounded-xl bg-[var(--card)] px-3 py-2 text-sm outline-none"
        />
        <button disabled={busy || !input.trim()} className="rounded-xl bg-[var(--btn)] px-4 text-sm font-medium text-[var(--btn-text)] disabled:opacity-40">
          {L.send}
        </button>
      </form>
    </div>
  );
}
