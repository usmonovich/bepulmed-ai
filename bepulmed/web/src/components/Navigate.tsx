import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Circle, CircleMarker, MapContainer, Polyline, useMap } from "react-leaflet";
import { BaseLayer } from "./BaseLayer";
import { formatDistance, telHref } from "../lib/geo";
import type { Lang } from "../lib/i18n";
import { compassWord, navInfo, systemNavUrl } from "../lib/navigate";
import { useOnline } from "../lib/net";
import { openLink } from "../lib/telegram";

export interface NavTarget {
  name: string;
  lat: number;
  lon: number;
  address?: string;
  phone?: string;
  /** Точное место ещё не определено: показываем центр района и адрес. */
  approx?: boolean;
}

function Fit({ a, b }: { a: { lat: number; lon: number } | null; b: NavTarget }) {
  // Приблизительная цель (центр района) — показываем район целиком.
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    setTimeout(() => map.invalidateSize(), 0);
    if (!a || b.approx) return void map.setView([b.lat, b.lon], b.approx ? 13 : 16);
    if (done.current) return;
    done.current = true;
    map.fitBounds(
      [
        [a.lat, a.lon],
        [b.lat, b.lon],
      ],
      { padding: [40, 40], maxZoom: 17 },
    );
  }, [a, b, map]);
  return null;
}

/** Навигация до учреждения: работает без интернета (GPS + встроенная карта Ташкента). */
export function Navigate({ to, lang, onClose }: { to: NavTarget; lang: Lang; onClose: () => void }) {
  const ru = lang === "ru";
  const online = useOnline();
  const [me, setMe] = useState<{ lat: number; lon: number; acc: number } | null>(null);
  const [gpsErr, setGpsErr] = useState<string | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setGpsErr(ru ? "Геолокация недоступна на этом устройстве." : "Bu qurilmada geolokatsiya yo‘q.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGpsErr(null);
        setMe({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy });
      },
      (e) =>
        setGpsErr(
          e.code === 1
            ? ru
              ? "Нет доступа к геолокации — разрешите её в настройках."
              : "Geolokatsiyaga ruxsat yo‘q — sozlamalarda ruxsat bering."
            : ru
              ? "Ищу спутники GPS… Выйдите на открытое место."
              : "GPS sun’iy yo‘ldoshlari qidirilmoqda… Ochiq joyga chiqing.",
        ),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [ru]);

  const info = me && !to.approx ? navInfo(me, to) : null;
  const tel = to.phone ? telHref(to.phone) : null;

  // Портал в body: окно поверх всего, вне контейнеров вкладок и других карт.
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex flex-col" style={{ background: "var(--bg)" }} data-testid="navigate">
      <div className="flex items-center gap-2 border-b border-black/10 p-2">
        <button onClick={onClose} className="rounded-lg px-2 py-1 text-lg" aria-label={ru ? "Закрыть" : "Yopish"}>
          ←
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{to.name}</div>
          {to.address && <div className="truncate text-xs text-[var(--hint)]">{to.address}</div>}
        </div>
        {!online && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px]">📴 {ru ? "офлайн" : "oflayn"}</span>}
      </div>
      <div className="min-h-0 flex-1">
        <MapContainer center={[to.lat, to.lon]} zoom={to.approx ? 13 : 15} style={{ height: "100%", width: "100%" }}>
          <BaseLayer lang={lang} />
          <Fit a={me} b={to} />
          {me && !to.approx && (
            <Polyline
              positions={[
                [me.lat, me.lon],
                [to.lat, to.lon],
              ]}
              pathOptions={{ color: "#0b7a5a", weight: 4, dashArray: "8 8" }}
            />
          )}
          {to.approx ? (
            <Circle center={[to.lat, to.lon]} radius={1500} pathOptions={{ color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.12, dashArray: "6 6" }} />
          ) : (
            <CircleMarker center={[to.lat, to.lon]} radius={10} pathOptions={{ color: "#dc2626", fillColor: "#dc2626", fillOpacity: 0.9 }} />
          )}
          {me && <CircleMarker center={[me.lat, me.lon]} radius={8} pathOptions={{ color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }} />}
        </MapContainer>
      </div>
      <div className="space-y-2 border-t border-black/10 p-3 text-sm" data-testid="nav-panel">
        {to.approx && (
          <div className="rounded-xl bg-amber-50 p-2 text-xs text-amber-900" data-testid="nav-approx">
            📍 {ru ? "Точное место на карте ещё не определено — показан центр района." : "Aniq joy hali aniqlanmagan — tuman markazi ko‘rsatilgan."}
            {to.address && (
              <div className="mt-1 text-sm font-semibold text-black">
                {ru ? "Адрес:" : "Manzil:"} {to.address}
              </div>
            )}
            <div className="mt-1">
              {ru ? "Позвоните, чтобы уточнить дорогу, или откройте адрес в навигаторе." : "Yo‘lni aniqlash uchun qo‘ng‘iroq qiling yoki manzilni navigatorda oching."}
            </div>
          </div>
        )}
        {to.approx ? null : info ? (
          info.arrived ? (
            <div className="text-base font-semibold text-emerald-700" data-testid="nav-arrived">
              ✅ {ru ? "Вы на месте" : "Yetib keldingiz"}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="text-3xl" style={{ transform: `rotate(${info.bearing}deg)` }} aria-hidden>
                ⬆️
              </div>
              <div>
                <div className="text-lg font-semibold" data-testid="nav-distance">
                  {formatDistance(info.meters, lang)} {compassWord(info.bearing, lang)}
                </div>
                <div className="text-xs text-[var(--hint)]">
                  {ru ? `по прямой · пешком около ${info.walkMin} мин` : `to‘g‘ri chiziqda · piyoda ~${info.walkMin} daq`}
                  {me && me.acc > 60 ? (ru ? ` · точность GPS ±${Math.round(me.acc)} м` : ` · GPS aniqligi ±${Math.round(me.acc)} m`) : ""}
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="text-xs text-[var(--hint)]">{gpsErr ?? (ru ? "Определяю местоположение (GPS работает без интернета)…" : "Joylashuv aniqlanmoqda (GPS internetsiz ishlaydi)…")}</div>
        )}
        <div className="flex gap-2">
          <button onClick={() => openLink(systemNavUrl(to, to.name))} className="flex-1 rounded-xl bg-[var(--btn)] py-2 text-xs font-medium text-[var(--btn-text)]" data-testid="nav-external">
            🧭 {to.approx ? (ru ? "Найти адрес в навигаторе" : "Manzilni navigatorda topish") : ru ? "Маршрут по улицам в навигаторе" : "Navigatorda ko‘chalar bo‘yicha"}
          </button>
          {tel && (
            <a href={tel} className="rounded-xl border border-[var(--btn)] px-3 py-2 text-xs text-[var(--link)]" data-testid="nav-call">
              📞 {to.approx ? (ru ? "Позвонить" : "Qo‘ng‘iroq") : ""}
            </a>
          )}
        </div>
        <p className="text-[10px] text-[var(--hint)]">
          {ru
            ? "Карта Ташкента и GPS работают без интернета. Пошаговый маршрут — в Яндекс Картах, 2GIS или другом навигаторе (если там скачана офлайн-карта)."
            : "Toshkent xaritasi va GPS internetsiz ishlaydi. Qadam-baqadam yo‘nalish — Yandex Xaritalar, 2GIS yoki boshqa navigatorda (oflayn xarita yuklangan bo‘lsa)."}
        </p>
      </div>
    </div>,
    document.body,
  );
}
