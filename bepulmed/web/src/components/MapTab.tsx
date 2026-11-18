import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Popup, useMap } from "react-leaflet";
import { getClinics, getFacilities, type Facility } from "../lib/api";
import { distanceMeters, formatDistance, telHref, TASHKENT_CENTER } from "../lib/geo";
import { t, type Lang } from "../lib/i18n";
import { openLink, requestLocation } from "../lib/telegram";
import { VERIFIED_FACILITIES } from "../data/verifiedFacilities";
import { mergeFacilities } from "../lib/facilities";
import { facilitiesNearLocal, inTashkent, refreshTashkent, type LocalFacilities } from "../lib/offline";
import { BaseLayer } from "./BaseLayer";
import { Navigate, type NavTarget } from "./Navigate";
import { DISTRICTS, nearestDistrict, TASHKENT_FACILITIES, type TkFacility } from "../data/tashkentFacilities";
import { loadCoords } from "../lib/coords";
import { mapPack, type MapPack } from "../lib/mapPack";
import { useOnline } from "../lib/net";
import { PlaceBadges, PlaceOnline } from "./PlaceExtras";
import { facilityStatus } from "../lib/placeInfo";

type Kind = Facility["kind"];
type State = "ask" | "locating" | "loading" | "ready" | "error";

const COLORS: Record<Kind, string> = { hospital: "#dc2626", clinic: "#0b7a5a", pharmacy: "#2563eb" };

function Recenter({ center, visible }: { center: { lat: number; lon: number }; visible: boolean }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lon], map.getZoom());
  }, [center.lat, center.lon, map]);
  // Карта во вкладке, скрытой через display:none, теряет размеры — пересчитываем при показе.
  useEffect(() => {
    if (visible) setTimeout(() => map.invalidateSize(), 0);
  }, [visible, map]);
  return null;
}

export function MapTab({ lang, visible, onBook, openNowReq }: { lang: Lang; visible: boolean; onBook: () => void; openNowReq?: { kind: Kind | "all"; n: number } }) {
  const L = t(lang);
  const [state, setState] = useState<State>("ask");
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [denied, setDenied] = useState(false);
  const [items, setItems] = useState<Facility[]>([]);
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [radius, setRadius] = useState(3000);
  const [active, setActive] = useState<string | null>(null);
  const [osmFailed, setOsmFailed] = useState(false);
  const [local, setLocal] = useState<LocalFacilities | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [openNow, setOpenNow] = useState(false);
  const [navTo, setNavTo] = useState<NavTarget | null>(null);
  // Нет данных OSM (первый запуск без интернета, снимок не встроен) — учреждения из справочника приложения.
  const [fallback, setFallback] = useState<TkFacility[] | null>(null);
  const [pack, setPack] = useState<MapPack | null | undefined>(undefined);
  const online = useOnline();
  useEffect(() => {
    void mapPack().then(setPack);
  }, []);
  // Голосом: «открытые аптеки сейчас» → фильтр.
  useEffect(() => {
    if (!openNowReq) return;
    setOpenNow(true);
    setFilter(openNowReq.kind);
    if (state === "ask") void locate(); // сразу ищем рядом — без второго нажатия
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNowReq]);

  async function connectedClinics(): Promise<Facility[]> {
    try {
      const { clinics } = await getClinics();
      return clinics.map((c) => ({
        id: `clinic:${c.id}`,
        name: lang === "uz" ? c.name_uz : c.name_ru,
        kind: c.kind,
        lat: c.lat,
        lon: c.lon,
        address: c.address ?? undefined,
        phone: c.phone ?? undefined,
        source: "connected" as const,
        verified: false,
        bookable: true,
        isDemo: c.is_demo,
      }));
    } catch {
      return [];
    }
  }

  async function load(at: { lat: number; lon: number }, r: number) {
    setState("loading");
    // Подключённые клиники (запись доступна) + проверенные + OSM. Подключённые показываем всегда, даже вне радиуса.
    // Сервер недоступен → данные OpenStreetMap прямо с телефона (Ташкент — из сохранённых на устройстве).
    let fromLocal: LocalFacilities | null = null;
    // В Ташкенте — данные города на телефоне: местоположение никуда не уходит.
    const serverOsm = () =>
      getFacilities(at.lat, at.lon, lang, r).then((x) => x.facilities.filter((f) => distanceMeters(at, f) <= r));
    const firstTry = inTashkent(at)
      ? facilitiesNearLocal(at, r, lang).then((l) => {
          fromLocal = l;
          return l.facilities;
        })
      : serverOsm();
    const [osm, connected] = await Promise.all([
      firstTry
        .catch(() => (inTashkent(at) ? serverOsm() : Promise.reject(new Error("x"))))
        .catch(() =>
          facilitiesNearLocal(at, r, lang)
            .then((l) => {
              fromLocal = l;
              return l.facilities;
            })
            .catch(() => null),
        ),
      connectedClinics(),
    ]);
    setLocal(fromLocal);
    const merged = [...connected, ...mergeFacilities(osm ?? [], VERIFIED_FACILITIES, at, r)];
    setItems(merged);
    if (osm === null && merged.length === 0) {
      const d = nearestDistrict(at);
      const coords = loadCoords();
      const list = TASHKENT_FACILITIES.filter((f) => (d ? f.district === d : true) || f.type === "emergency")
        .sort((a, b) => Number(b.district === d) - Number(a.district === d))
        .slice(0, 30);
      void coords;
      setFallback(list);
      setState("ready");
    } else {
      setFallback(null);
      setState("ready");
    }
    setOsmFailed(osm === null);
  }

  async function locate() {
    setState("locating");
    let at = TASHKENT_CENTER;
    try {
      at = await requestLocation();
      setDenied(false);
    } catch {
      setDenied(true);
    }
    setPos(at);
    await load(at, radius);
  }

  // Перезагрузка при смене языка/радиуса после первого поиска.
  useEffect(() => {
    if (pos) void load(pos, radius);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, radius]);

  const shown = useMemo(
    () => items.filter((f) => (filter === "all" || f.kind === filter) && (!openNow || facilityStatus(f)?.open === true)),
    [items, filter, openNow],
  );
  const kindLabel = (k: Kind) => (k === "hospital" ? L.kindHospital : k === "clinic" ? L.kindClinic : L.kindPharmacy);

  if (state === "ask" || state === "locating") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="text-5xl">📍</div>
        <p className="text-sm">{L.mapAsk}</p>
        <button onClick={locate} disabled={state === "locating"} className="rounded-xl bg-[var(--btn)] px-6 py-3 font-medium text-[var(--btn-text)] disabled:opacity-50">
          {state === "locating" ? "…" : L.mapAllow}
        </button>
        <p className="text-[11px] text-[var(--hint)]">{L.nearestNote}</p>
      </div>
    );
  }

  const center = pos ?? TASHKENT_CENTER;
  return (
    <div className="flex h-full flex-col">
      {navTo && <Navigate to={navTo} lang={lang} onClose={() => setNavTo(null)} />}
      {denied && <div className="bg-amber-50 px-3 py-1.5 text-xs text-amber-900">{L.mapDenied}</div>}
      <div className="relative h-[38%] min-h-[200px] p-2">
        {pack === null && !online && (
          <div className="pointer-events-none absolute inset-x-4 bottom-8 z-[500] rounded-lg bg-white/90 p-2 text-[11px] text-gray-700 shadow" data-testid="map-no-pack">
            🗺️ {lang === "ru" ? "Подложка карты этой сборки грузится из интернета (сохраняется просмотренное). Сборка со встроенной картой Ташкента работает полностью без сети." : "Bu yig‘ishda xarita foni internetdan yuklanadi. O‘rnatilgan Toshkent xaritali yig‘ish to‘liq internetsiz ishlaydi."}
          </div>
        )}
        <MapContainer center={[center.lat, center.lon]} zoom={14} scrollWheelZoom>
          <Recenter center={center} visible={visible} />
          <BaseLayer lang={lang} />
          {pos && !denied && <CircleMarker center={[pos.lat, pos.lon]} radius={7} pathOptions={{ color: "#111827", fillColor: "#3b82f6", fillOpacity: 1 }} />}
          {shown.map((f) => (
            <CircleMarker
              key={f.id}
              center={[f.lat, f.lon]}
              radius={active === f.id ? 10 : f.bookable ? 9 : 7}
              pathOptions={{ color: COLORS[f.kind], fillColor: COLORS[f.kind], fillOpacity: f.verified ? 0.9 : 0.5 }}
              eventHandlers={{ click: () => setActive(f.id) }}
            >
              <Popup>
                <b>{f.name}</b>
                <br />
                {kindLabel(f.kind)}
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto px-2 pb-2">
        {(["all", "clinic", "hospital", "pharmacy"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${filter === k ? "bg-[var(--btn)] text-[var(--btn-text)]" : "bg-[var(--card)]"}`}
          >
            {k === "all" ? L.filterAll : kindLabel(k)}
          </button>
        ))}
        <button
          onClick={() => setOpenNow((v) => !v)}
          className={`shrink-0 rounded-full px-3 py-1 text-xs ${openNow ? "bg-emerald-600 text-white" : "bg-[var(--card)]"}`}
          data-testid="filter-open-now"
        >
          🟢 {lang === "ru" ? "Открыто сейчас" : "Hozir ochiq"}
        </button>
        <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="ml-auto shrink-0 rounded-full bg-[var(--card)] px-2 py-1 text-xs" aria-label={L.radius}>
          {[1000, 3000, 5000, 10000].map((r) => (
            <option key={r} value={r}>
              {formatDistance(r, lang)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-3">
        {state === "loading" && <div className="animate-pulse p-3 text-sm text-[var(--hint)]">{L.mapLoading}</div>}
        {state === "error" && (
          <div className="p-3 text-sm">
            {L.mapError}{" "}
            <button onClick={() => pos && load(pos, radius)} className="text-[var(--link)] underline">
              {L.retry}
            </button>
          </div>
        )}
        {state === "ready" && osmFailed && !fallback && (
          <div className="rounded-xl bg-amber-50 p-2 text-xs text-amber-900">
            {L.mapError}{" "}
            <button onClick={() => pos && load(pos, radius)} className="underline">
              {L.retry}
            </button>
          </div>
        )}
        {state === "ready" && shown.length === 0 && !fallback && (
          <div className="p-3 text-sm text-[var(--hint)]">
            {openNow ? (lang === "ru" ? "Среди учреждений с известными часами работы открытых сейчас не нашлось. Снимите фильтр «Открыто сейчас» или увеличьте радиус." : "Ish vaqti ma’lum muassasalar orasida hozir ochig‘i topilmadi.") : L.nothingFound}
          </div>
        )}
        {state === "ready" && shown.length > 0 && <p className="px-1 text-[11px] text-[var(--hint)]">{L.nearestNote}</p>}
        {state === "ready" &&
          shown.map((f) => {
            const tel = f.phone ? telHref(f.phone) : null;
            return (
              <div
                key={f.id}
                onClick={() => setActive(f.id)}
                className={`rounded-2xl bg-[var(--card)] p-3 text-sm ${active === f.id ? "ring-2 ring-[var(--btn)]" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{f.name}</div>
                    <div className="text-xs" style={{ color: COLORS[f.kind] }}>
                      {kindLabel(f.kind)} · {pos ? formatDistance(distanceMeters(pos, f), lang) : ""}
                    </div>
                    <PlaceBadges f={f} lang={lang} />
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] ${f.bookable ? "bg-emerald-600 text-white" : f.verified ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-700"}`}
                  >
                    {f.bookable ? `📅 ${L.statusBookable}` : f.verified ? `✓ ${L.statusInfo}` : L.statusUnverified}
                    {f.isDemo ? ` · ${L.demoBadge}` : ""}
                  </span>
                </div>
                <dl className="mt-2 space-y-0.5 text-xs">
                  <div>
                    <span className="text-[var(--hint)]">{L.address}: </span>
                    {f.address ?? L.noData}
                  </div>
                  <div>
                    <span className="text-[var(--hint)]">{L.phone}: </span>
                    {f.phone ?? L.noData}
                  </div>
                  <div>
                    <span className="text-[var(--hint)]">{L.hours}: </span>
                    {f.openingHours ?? L.noData}
                  </div>
                </dl>
                {f.source !== "connected" && <PlaceOnline f={f} lang={lang} />}
                {f.source === "osm" && <div className="mt-1 text-[10px] text-[var(--hint)]">{L.notVerified}</div>}
                {f.verified && f.sourceUrl && (
                  <button onClick={() => openLink(f.sourceUrl!)} className="mt-1 text-[10px] text-[var(--link)] underline">
                    {L.sources}
                  </button>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setNavTo({ name: f.name, lat: f.lat, lon: f.lon, address: f.address, phone: f.phone });
                    }}
                    className="flex-1 rounded-xl bg-[var(--btn)] py-1.5 text-xs font-medium text-[var(--btn-text)]"
                    data-testid="nav-open"
                  >
                    🧭 {L.route}
                  </button>
                  {tel && (
                    <a href={tel} className="flex-1 rounded-xl border border-[var(--btn)] py-1.5 text-center text-xs text-[var(--link)]">
                      📞 {L.call}
                    </a>
                  )}
                  {f.bookable && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onBook();
                      }}
                      className="flex-1 rounded-xl bg-emerald-600 py-1.5 text-xs font-medium text-white"
                    >
                      📅 {L.bookThis}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        {state === "ready" && fallback && (
          <div className="space-y-2" data-testid="map-fallback">
            <div className="rounded-xl bg-amber-50 p-2 text-xs text-amber-900">
              {lang === "ru"
                ? `Нет интернета и сохранённых данных карты. Показываю государственные учреждения ${pos ? `района «${DISTRICTS[nearestDistrict(pos) ?? "chilonzor"].ru}»` : "Ташкента"} и экстренные центры из справочника приложения. При подключении к интернету аптеки и клиники загрузятся сами.`
                : `Internet va saqlangan xarita ma’lumotlari yo‘q. Ilova ma’lumotnomasidan tumaningizdagi davlat muassasalari va shoshilinch markazlar ko‘rsatilmoqda. Internet ulanganda dorixona va klinikalar o‘zi yuklanadi.`}
            </div>
            {fallback.map((f) => {
              const c = loadCoords()[f.id];
              const name = lang === "uz" ? f.uz : f.ru;
              const tel = f.phones?.[0] ? telHref(f.phones[0]) : null;
              return (
                <div key={f.id} className="rounded-2xl bg-[var(--card)] p-3 text-sm" data-testid="fallback-card">
                  <div className="font-semibold">{name}</div>
                  <div className="text-xs text-[var(--hint)]">📍 {f.address}</div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        const d = f.district ? DISTRICTS[f.district] : DISTRICTS.chilonzor;
                        setNavTo(c ? { name, lat: c.lat, lon: c.lon, address: f.address, phone: f.phones?.[0] } : { name, lat: d.lat, lon: d.lon, address: f.address, phone: f.phones?.[0], approx: true });
                      }}
                      className="flex-1 rounded-xl bg-[var(--btn)] py-1.5 text-xs font-medium text-[var(--btn-text)]"
                      data-testid="nav-open"
                    >
                      🧭 {L.route}
                    </button>
                    {tel && (
                      <a href={tel} className="flex-1 rounded-xl border border-[var(--btn)] py-1.5 text-center text-xs text-[var(--link)]">
                        📞 {L.call}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {state === "ready" && local?.from === "tashkent_cache" && (
          <div className="flex items-center gap-2 rounded-xl bg-[var(--card)] p-2 text-[11px] text-[var(--hint)]" data-testid="tashkent-cache">
            <span className="flex-1">
              {lang === "ru" ? "Данные по Ташкенту сохранены на телефоне, работают без интернета. Обновлено" : "Toshkent ma’lumotlari telefonda saqlangan, internetsiz ishlaydi. Yangilangan"}{" "}
              {new Date(local.fetchedAt).toLocaleDateString(lang === "ru" ? "ru-RU" : "uz-UZ")}
            </span>
            <button
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                try {
                  await refreshTashkent();
                  if (pos) await load(pos, radius);
                } catch {
                  setOsmFailed(true);
                } finally {
                  setRefreshing(false);
                }
              }}
              className="shrink-0 text-[var(--link)] underline disabled:opacity-50"
            >
              {refreshing ? "…" : lang === "ru" ? "Обновить" : "Yangilash"}
            </button>
          </div>
        )}
        <p className="pt-1 text-center text-[10px] text-[var(--hint)]">{L.osmAttribution}</p>
      </div>
    </div>
  );
}
