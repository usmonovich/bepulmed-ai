import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { checkInPayload, shortCode } from "../lib/api";

/** QR-код талона для регистрации прихода + короткий код для ручного ввода. Генерируется локально, без сети. */
export function TicketQR({ appointmentId, hint, codeLabel }: { appointmentId: string; hint: string; codeLabel: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(checkInPayload(appointmentId), { margin: 1, width: 360, errorCorrectionLevel: "M" })
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [appointmentId]);
  return (
    <div className="mt-2 flex items-center gap-3 rounded-xl bg-white p-2 text-black" data-testid="ticket-qr">
      {src ? <img src={src} alt="QR" className="h-28 w-28 shrink-0" /> : <div className="h-28 w-28 shrink-0 animate-pulse rounded bg-black/10" />}
      <div className="text-xs">
        <p>{hint}</p>
        <p className="mt-1 text-gray-500">
          {codeLabel}: <b className="font-mono text-sm tracking-wider text-black">{shortCode(appointmentId)}</b>
        </p>
      </div>
    </div>
  );
}
