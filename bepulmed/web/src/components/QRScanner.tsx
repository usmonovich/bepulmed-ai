import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/**
 * Сканер QR для регистратуры: камера ноутбука/телефона через getUserMedia + jsQR (всё локально).
 * Если камеры нет или доступ не дан — ручной ввод короткого кода с талона.
 */
export function QRScanner({ onCode, onClose, busy }: { onCode: (code: string) => void; onClose: () => void; busy: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [camErr, setCamErr] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamErr("Камера недоступна в этом браузере — введите код вручную.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        setCamErr("Нет доступа к камере — разрешите его или введите код вручную.");
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      const tick = () => {
        if (stopped) return;
        const c = canvasRef.current;
        if (c && v.readyState >= 2 && v.videoWidth) {
          const w = Math.min(640, v.videoWidth);
          const h = Math.round((v.videoHeight / v.videoWidth) * w);
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(v, 0, 0, w, h);
          const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
          const now = Date.now();
          // Один и тот же код не отправляем чаще раза в 4 секунды.
          if (found?.data && !busyRef.current && (found.data !== lastRef.current.code || now - lastRef.current.at > 4000)) {
            lastRef.current = { code: found.data, at: now };
            onCode(found.data);
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label="Сканер QR">
      <div className="w-full max-w-md space-y-3 rounded-2xl bg-[var(--bg)] p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">📷 Регистрация по QR-коду талона</h2>
          <button onClick={onClose} className="px-2 text-lg" aria-label="Закрыть">
            ✕
          </button>
        </div>
        {camErr ? (
          <p className="rounded-xl bg-amber-50 p-2 text-sm text-amber-900">{camErr}</p>
        ) : (
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" />
            <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/70" />
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) onCode(manual.trim());
          }}
        >
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Код с талона, например 3F9A-21C0" className="flex-1 rounded-lg bg-[var(--card)] px-2 py-1.5 font-mono text-sm uppercase" aria-label="Код с талона" />
          <button disabled={busy} className="rounded-lg bg-[var(--btn)] px-3 text-sm text-[var(--btn-text)] disabled:opacity-40">
            Отметить
          </button>
        </form>
        <p className="text-xs text-[var(--hint)]">Отмечаются только сегодняшние записи вашей клиники. Каждое действие пишется в журнал.</p>
      </div>
    </div>
  );
}
