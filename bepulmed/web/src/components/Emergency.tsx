import { t, type Lang } from "../lib/i18n";

export function EmergencyButtons({ lang, className = "" }: { lang: Lang; className?: string }) {
  const L = t(lang);
  return (
    <div className={`flex gap-2 ${className}`}>
      <a href="tel:103" className="flex-1 rounded-xl bg-red-600 py-2 text-center text-sm font-bold text-white">
        📞 {L.call103}
      </a>
      <a href="tel:112" className="flex-1 rounded-xl bg-red-100 py-2 text-center text-sm font-bold text-red-700">
        📞 {L.call112}
      </a>
    </div>
  );
}

export function EmergencyBar({ lang, onSos }: { lang: Lang; onSos?: () => void }) {
  const L = t(lang);
  return (
    <div className="flex items-center justify-between gap-2 bg-red-600 px-3 py-1.5 text-xs text-white">
      <span>{L.emergencyBar}</span>
      <span className="flex items-center gap-3 font-bold">
        <a href="tel:103" className="underline">103</a>
        <a href="tel:112" className="underline">112</a>
        {onSos && (
          <button onClick={onSos} className="rounded-md bg-white px-2 py-0.5 text-red-700" data-testid="sos-btn">
            SOS
          </button>
        )}
      </span>
    </div>
  );
}
