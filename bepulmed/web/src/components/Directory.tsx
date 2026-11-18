import { useEffect, useMemo, useState } from "react";
import { searchFacilities } from "../lib/facilitySearch";
import { CircleMarker, MapContainer, Popup, Tooltip } from "react-leaflet";
import { ensureCoords, loadCoords, type Coord } from "../lib/coords";
import { distanceMeters, formatDistance } from "../lib/geo";
import { norm } from "../lib/search";
import { addressRouteUrl, DISTRICTS, HOTLINE, nearestDistrict, sourceUrl, TASHKENT_FACILITIES, type District, type FacilityType, type TkFacility } from "../data/tashkentFacilities";
import { search } from "../lib/search";
import { telHref } from "../lib/geo";
import { openLink, requestLocation } from "../lib/telegram";
import { PlaceOnline } from "./PlaceExtras";
import { Navigate, type NavTarget } from "./Navigate";
import { FacilityPage } from "./FacilityPage";
import { SPECIALTIES, type Specialty } from "../../../worker/src/doctors";
import type { Lang } from "../lib/i18n";
import { VoiceInput } from "./VoiceInput";
import { BaseLayer } from "./BaseLayer";

// Справочник государственных медучреждений Ташкента — встроен в приложение, работает без сервера и интернета.

const T = {
  ru: {
    title: "Клиники Ташкента",
    sub: (n: number) => `${n} государственных учреждений · работает без интернета`,
    dataNote: "Справочный каталог, не государственный реестр. Адреса, телефоны и часы могут быть неполными или устаревшими — перед поездкой уточните у учреждения или по 1003. OSM/каталоги не считаются официальным подтверждением.",
    ph: "Поиск: «кардиология», «поликлиника 36», «Чиланзар», «глаза»",
    all: "Все",
    types: { family: "Семейные", central: "Районные", specialized: "Спец. центры", emergency: "Экстренная", other: "Прочие" } as Record<FacilityType, string>,
    typeFull: { family: "Семейная поликлиника", central: "Районная (центральная) поликлиника", specialized: "Республиканский специализированный центр", emergency: "Экстренная помощь 24/7", other: "Учреждение" } as Record<FacilityType, string>,
    district: "Район",
    allDistricts: "Все районы",
    myDistrict: "📍 Мой район",
    locating: "Определяю…",
    notInTashkent: "Похоже, вы не в Ташкенте — выберите район вручную.",
    route: "🧭 Маршрут",
    site: "Сайт",
    src: "Источник",
    none: "Ничего не найдено. Попробуйте другое слово или уберите фильтры.",
    free: "Бесплатная плановая помощь — в семейной поликлинике по месту прикрепления. В республиканские центры — по направлению врача. При угрозе жизни — 103.",
    hotline: "Вопросы и жалобы:",
    found: "Найдено",
    approx: "район определён по GPS приблизительно",
    map: "🗺️ Карта рядом",
    noPhone: "телефон уточняйте по 1003",
    nearest: "📍 Ближайшие ко мне",
    list: "Список",
    mapView: "🗺️ На карте",
    coords: (n: number, all: number) => `Координаты: ${n} из ${all}`,
    coordsNone: "Расположение на карте появится после первого запуска с интернетом (один раз).",
    coordsLoading: "Определяю расположение учреждений…",
    km: "км",
    gpsFail: "Не удалось определить местоположение.",
    tilesNote: "Подложка карты загружается из интернета; точки и расстояния работают офлайн.",
  },
  uz: {
    title: "Toshkent klinikalari",
    sub: (n: number) => `${n} ta davlat muassasasi · internetsiz ishlaydi`,
    dataNote: "Ma’lumotnoma katalogi, davlat reyestri emas. Manzil, telefon va ish vaqti to‘liq bo‘lmasligi yoki eskirgan bo‘lishi mumkin — borishdan oldin muassasa yoki 1003 orqali aniqlang. OSM/kataloglar rasmiy tasdiq hisoblanmaydi.",
    ph: "Qidiruv: «kardiologiya», «36 poliklinika», «Chilonzor», «ko‘z»",
    all: "Hammasi",
    types: { family: "Oilaviy", central: "Tuman", specialized: "Ixtisos. markaz", emergency: "Shoshilinch", other: "Boshqa" } as Record<FacilityType, string>,
    typeFull: { family: "Oilaviy poliklinika", central: "Tuman (markaziy) poliklinikasi", specialized: "Respublika ixtisoslashtirilgan markazi", emergency: "Shoshilinch yordam 24/7", other: "Muassasa" } as Record<FacilityType, string>,
    district: "Tuman",
    allDistricts: "Barcha tumanlar",
    myDistrict: "📍 Mening tumanim",
    locating: "Aniqlanmoqda…",
    notInTashkent: "Siz Toshkentda emassiz shekilli — tumanni qo‘lda tanlang.",
    route: "🧭 Yo‘nalish",
    site: "Sayt",
    src: "Manba",
    none: "Hech narsa topilmadi. Boshqa so‘z bilan urinib ko‘ring yoki filtrlarni olib tashlang.",
    free: "Bepul rejali yordam — biriktirilgan oilaviy poliklinikada. Respublika markazlariga — shifokor yo‘llanmasi bilan. Hayotga xavf bo‘lsa — 103.",
    hotline: "Savol va shikoyatlar:",
    found: "Topildi",
    approx: "tuman GPS bo‘yicha taxminan aniqlandi",
    map: "🗺️ Yaqin atrof xaritasi",
    noPhone: "telefonni 1003 orqali aniqlang",
    nearest: "📍 Menga eng yaqin",
    list: "Ro‘yxat",
    mapView: "🗺️ Xaritada",
    coords: (n: number, all: number) => `Koordinatalar: ${n} / ${all}`,
    coordsNone: "Xaritadagi joylashuv birinchi marta internet bilan ishga tushirilgandan keyin paydo bo‘ladi (bir marta).",
    coordsLoading: "Muassasalar joylashuvi aniqlanmoqda…",
    km: "km",
    gpsFail: "Joylashuvni aniqlab bo‘lmadi.",
    tilesNote: "Xarita foni internetdan yuklanadi; nuqtalar va masofalar internetsiz ishlaydi.",
  },
};

const BADGE: Record<FacilityType, string> = {
  family: "bg-emerald-100 text-emerald-800",
  central: "bg-blue-100 text-blue-800",
  specialized: "bg-purple-100 text-purple-800",
  emergency: "bg-red-100 text-red-700",
  other: "bg-gray-100 text-gray-700",
};

function Card({ f, lang, km, coord, onNav, onOpen }: { f: TkFacility; lang: Lang; km?: number; coord?: Coord; onNav?: (t: NavTarget) => void; onOpen?: () => void }) {
  const L = T[lang];
  return (
    <div className="rounded-2xl bg-[var(--card)] p-3" data-testid="facility-card">
      <div className="flex items-start justify-between gap-2">
        <button onClick={onOpen} className="text-left font-semibold leading-snug" data-testid="facility-open">
          {lang === "uz" ? f.uz : f.ru}
        </button>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${BADGE[f.type]}`}>{L.types[f.type]}</span>
      </div>
      <div className="mt-0.5 text-xs text-[var(--hint)]">
        {L.typeFull[f.type]}
        {f.district ? ` · ${lang === "uz" ? DISTRICTS[f.district].uz : DISTRICTS[f.district].ru}${lang === "uz" ? "" : " район"}` : ""}
      </div>
      <div className="mt-1 text-sm">
        📍 {f.address}
        {km != null && <b className="ml-1 text-[var(--link)]">· {formatDistance(km * 1000, lang)}</b>}
      </div>
      {f.phones?.length ? (
        <div className="mt-1 flex flex-wrap gap-x-3 text-sm">
          {f.phones.map((p) => (
            <a key={p} href={telHref(p) ?? `tel:${p}`} className="text-[var(--link)] underline">
              📞 {p}
            </a>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-xs text-[var(--hint)]">📞 {L.noPhone}</div>
      )}
      <div className="mt-1 text-[10px]">
        <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-sky-800" data-testid="ownership" data-own="free">
          🏛 {lang === "uz" ? "Davlat · biriktirilganlarga bepul" : "Гос. · бесплатно по прикреплению"}
        </span>
      </div>
      {onOpen && (
        <button onClick={onOpen} className="mt-2 w-full rounded-xl border border-black/10 py-1.5 text-xs" data-testid="facility-more">
          👩‍⚕️ {lang === "uz" ? "Shifokorlar, qabul vaqti, sharhlar" : "Врачи и часы приёма, отзывы"} →
        </button>
      )}
      <PlaceOnline f={{ name: f.ru, kind: f.type === "emergency" || f.type === "specialized" ? "hospital" : "clinic", lat: coord?.lat, lon: coord?.lon }} lang={lang} district={f.district ?? undefined} />
      <div className="mt-2 flex gap-2">
        <button onClick={() => {
            const name = lang === "uz" ? f.uz : f.ru;
            if (!onNav) return openLink(addressRouteUrl(f));
            if (coord) return onNav({ name, lat: coord.lat, lon: coord.lon, address: f.address, phone: f.phones?.[0] });
            const c = f.district ? DISTRICTS[f.district] : { lat: 41.2995, lon: 69.2401 };
            onNav({ name, lat: c.lat, lon: c.lon, address: f.address, phone: f.phones?.[0], approx: true });
          }} data-testid="nav-open" className="flex-1 rounded-xl bg-[var(--btn)] py-1.5 text-xs font-medium text-[var(--btn-text)]">
          {L.route}
        </button>
        {f.website && (
          <button onClick={() => openLink(f.website!)} className="rounded-xl bg-white px-3 py-1.5 text-xs text-[var(--link)]">
            {L.site}
          </button>
        )}
      </div>
      <button onClick={() => openLink(sourceUrl(f))} className="mt-1 text-[10px] text-[var(--hint)] underline">
        {L.src}: {f.src === "gov" ? "gov.uz" : f.src === "gp" ? "goldenpages.uz" : "yellowpages.uz"} · 18.11.2026
      </button>
    </div>
  );
}

const TYPE_COLOR: Record<FacilityType, string> = { family: "#059669", central: "#2563eb", specialized: "#7c3aed", emergency: "#dc2626", other: "#6b7280" };

export function Directory({ lang, query: externalQuery, near: nearReq, onShowMap }: { lang: Lang; query?: { text: string; n: number }; near?: number; onShowMap: () => void }) {
  const L = T[lang];
  const [coords, setCoords] = useState<Record<string, Coord>>(loadCoords);
  const [coordsBusy, setCoordsBusy] = useState(false);
  const [navTo, setNavTo] = useState<NavTarget | null>(null);
  const [page, setPage] = useState<TkFacility | null>(null);
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [gpsErr, setGpsErr] = useState(false);

  // Расположение учреждений: определяется один раз при наличии интернета и хранится на устройстве.
  useEffect(() => {
    const on = () => setCoords(loadCoords());
    window.addEventListener("bm-coords", on);
    if (Object.keys(loadCoords()).length < TASHKENT_FACILITIES.length && navigator.onLine) {
      setCoordsBusy(true);
      void ensureCoords().finally(() => setCoordsBusy(false));
    }
    return () => window.removeEventListener("bm-coords", on);
  }, []);

  async function locateNear() {
    setGpsErr(false);
    try {
      const p = await requestLocation();
      setPos(p);
      setDistrict("all");
    } catch {
      setGpsErr(true);
    }
  }

  // Голосовой помощник: «ближайшая поликлиника».
  useEffect(() => {
    if (nearReq) void locateNear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearReq]);
  const [q, setQ] = useState("");
  const [type, setType] = useState<FacilityType | "all">("all");
  const [district, setDistrict] = useState<District | "all">("all");
  const [gps, setGps] = useState<"idle" | "busy" | "ok" | "out">("idle");

  useEffect(() => {
    if (externalQuery?.text) {
      setQ(externalQuery.text);
      setType("all");
    }
  }, [externalQuery]);

  const filtered = useMemo(() => TASHKENT_FACILITIES.filter((f) => (type === "all" || f.type === type) && (district === "all" || f.district === district)), [type, district]);
  // «невролог», «nevrolog», «кардиолог»… — поиск по специальности врача
  const querySpecialty = useMemo<Specialty | null>(() => {
    const n = norm(q);
    if (n.length < 4) return null;
    for (const [k, v] of Object.entries(SPECIALTIES) as [Specialty, (typeof SPECIALTIES)[Specialty]][]) {
      if (k === "other") continue;
      if ([v.ru, v.uz, ...v.aliases].some((a) => { const an = norm(a); return an.length >= 4 && (n.includes(an) || an.startsWith(n)); })) return k;
    }
    return null;
  }, [q]);
  const list = useMemo(() => {
    let l: TkFacility[];
    if (q.trim() && querySpecialty) {
      // Специалисты принимают в семейных и районных поликлиниках; расписание — на странице поликлиники.
      const hits = searchFacilities(q, filtered).map((h) => h.item);
      l = hits.length ? hits : filtered.filter((f) => f.type === "family" || f.type === "central" || f.type === "specialized");
    } else if (q.trim()) l = searchFacilities(q, filtered).map((h) => h.item);
    else {
      const order: Record<FacilityType, number> = { emergency: 0, family: 1, central: 2, specialized: 3, other: 4 };
      l = [...filtered].sort((a, b) => order[a.type] - order[b.type]);
    }
    if (pos) {
      const d = (f: TkFacility) => (coords[f.id] ? distanceMeters(pos, coords[f.id]) : Infinity);
      l = [...l].sort((a, b) => d(a) - d(b));
    }
    return l;
  }, [q, filtered, pos, coords, querySpecialty]);
  const known = Object.keys(coords).length;

  async function myDistrict() {
    setGps("busy");
    try {
      const p = await requestLocation();
      const d = nearestDistrict(p);
      if (d) {
        setDistrict(d);
        setGps("ok");
      } else setGps("out");
    } catch {
      setGps("idle");
    }
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3 text-sm" data-testid="directory">
      {navTo && <Navigate to={navTo} lang={lang} onClose={() => setNavTo(null)} />}
      {page && <FacilityPage f={page} lang={lang} onClose={() => setPage(null)} initialSpecialty={querySpecialty} />}
      {querySpecialty && (
        <p className="rounded-xl bg-sky-50 p-2 text-xs text-sky-900" data-testid="spec-hint">
          👩‍⚕️ {lang === "uz" ? SPECIALTIES[querySpecialty].uz : SPECIALTIES[querySpecialty].ru}:{" "}
          {SPECIALTIES[querySpecialty].referral
            ? lang === "uz"
              ? "oilaviy shifokor yo‘llanmasi bilan. Poliklinikani oching — qabul vaqti e’lon qilingan bo‘lsa, ko‘rsatiladi."
              : "по направлению семейного врача. Откройте поликлинику — часы приёма видны, если поликлиника их опубликовала."
            : lang === "uz"
              ? "biriktirilgan poliklinikada. Poliklinikani oching — qabul vaqti."
              : "в поликлинике по прикреплению. Откройте поликлинику — часы приёма."}
        </p>
      )}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">🏥 {L.title}</h2>
          <p className="text-xs text-[var(--hint)]">{L.sub(TASHKENT_FACILITIES.length)}</p>
          <p className="mt-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{L.dataNote}</p>
        </div>
        <button onClick={onShowMap} className="shrink-0 rounded-xl bg-[var(--card)] px-2.5 py-1.5 text-xs">
          {L.map}
        </button>
      </div>

      <div className="sticky top-0 z-10 -mx-3 space-y-2 bg-[var(--bg)] px-3 pb-2">
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L.ph} maxLength={80} className="min-w-0 flex-1 rounded-xl bg-[var(--card)] px-3 py-2.5 outline-none" aria-label={L.ph} data-testid="dir-search" />
          <VoiceInput lang={lang} onText={setQ} />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {(["all", "family", "central", "specialized", "emergency"] as const).map((k) => (
            <button key={k} onClick={() => setType(k)} className={`shrink-0 rounded-full px-3 py-1 text-xs ${type === k ? "bg-[var(--btn)] text-[var(--btn-text)]" : "bg-[var(--card)]"}`}>
              {k === "all" ? L.all : L.types[k]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <select value={district} onChange={(e) => setDistrict(e.target.value as District | "all")} className="min-w-0 flex-1 rounded-xl bg-[var(--card)] px-2 py-1.5 text-xs" aria-label={L.district}>
            <option value="all">{L.allDistricts}</option>
            {(Object.keys(DISTRICTS) as District[])
              .filter((d) => d !== "region")
              .map((d) => (
                <option key={d} value={d}>
                  {lang === "uz" ? DISTRICTS[d].uz : DISTRICTS[d].ru}
                </option>
              ))}
          </select>
          <button onClick={myDistrict} disabled={gps === "busy"} className="shrink-0 rounded-xl bg-[var(--card)] px-2.5 text-xs disabled:opacity-50">
            {gps === "busy" ? L.locating : L.myDistrict}
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void locateNear()} className={`flex-1 rounded-xl px-2 py-1.5 text-xs font-medium ${pos ? "bg-[var(--btn)] text-[var(--btn-text)]" : "bg-[var(--card)]"}`} data-testid="dir-near">
            {L.nearest}
          </button>
          <button onClick={() => setView(view === "map" ? "list" : "map")} className="flex-1 rounded-xl bg-[var(--card)] px-2 py-1.5 text-xs" data-testid="dir-mapview">
            {view === "map" ? `📋 ${L.list}` : L.mapView}
          </button>
        </div>
        <p className="text-[10px] text-[var(--hint)]" data-testid="coords-status">
          📌 {coordsBusy ? L.coordsLoading : known ? L.coords(known, TASHKENT_FACILITIES.length) : L.coordsNone}
          {gpsErr && <span className="ml-1 text-amber-700">{L.gpsFail}</span>}
        </p>
        {gps === "ok" && <p className="text-[10px] text-[var(--hint)]">ℹ️ {L.approx}</p>}
        {gps === "out" && <p className="text-[11px] text-amber-800">{L.notInTashkent}</p>}
      </div>

      <p className="rounded-xl bg-emerald-50 p-2 text-xs text-emerald-900">ℹ️ {L.free}</p>
      {q.trim() && (
        <p className="text-xs text-[var(--hint)]" data-testid="dir-count">
          {L.found}: {list.length}
        </p>
      )}
      {list.length === 0 && <p className="rounded-xl bg-amber-50 p-3 text-amber-900">{L.none}</p>}
      {view === "map" ? (
        <div className="space-y-1">
          <div className="h-[55vh] overflow-hidden rounded-2xl" data-testid="dir-map">
            <MapContainer
              center={pos && list.some((f) => coords[f.id]) ? [pos.lat, pos.lon] : [41.3111, 69.2797]}
              zoom={pos && list.some((f) => coords[f.id]) ? 14 : 11}
              className="h-full w-full"
            >
              <BaseLayer lang={lang} />
              {pos && <CircleMarker center={[pos.lat, pos.lon]} radius={8} pathOptions={{ color: "#111", fillColor: "#3b82f6", fillOpacity: 1 }} />}
              {/* Координат ещё нет (первый запуск без интернета) — районы с числом учреждений. */}
              {!list.some((f) => coords[f.id]) &&
                (Object.keys(DISTRICTS) as District[])
                  .filter((d) => d !== "region" && list.some((f) => f.district === d))
                  .map((d) => {
                    const n = list.filter((f) => f.district === d).length;
                    return (
                      <CircleMarker
                        key={d}
                        center={[DISTRICTS[d].lat, DISTRICTS[d].lon]}
                        radius={10 + Math.min(n, 12)}
                        pathOptions={{ color: "#0b7a5a", weight: 2, fillColor: "#0b7a5a", fillOpacity: 0.25 }}
                        eventHandlers={{
                          click: () => {
                            setDistrict(d);
                            setView("list");
                          },
                        }}
                      >
                        <Tooltip permanent direction="center" className="!bg-white/90 !text-[10px]">
                          {(lang === "uz" ? DISTRICTS[d].uz : DISTRICTS[d].ru) + " · " + n}
                        </Tooltip>
                      </CircleMarker>
                    );
                  })}
              {list
                .filter((f) => coords[f.id])
                .map((f) => (
                  <CircleMarker key={f.id} center={[coords[f.id].lat, coords[f.id].lon]} radius={7} pathOptions={{ color: "#fff", weight: 2, fillColor: TYPE_COLOR[f.type], fillOpacity: 0.95 }}>
                    <Popup>
                      <b>{lang === "uz" ? f.uz : f.ru}</b>
                      <br />
                      {f.address}
                      {f.phones?.[0] && (
                        <>
                          <br />
                          <a href={`tel:${f.phones[0]}`}>{f.phones[0]}</a>
                        </>
                      )}
                    </Popup>
                  </CircleMarker>
                ))}
            </MapContainer>
          </div>
          <p className="text-[10px] text-[var(--hint)]">{L.tilesNote}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((f) => (
            <Card key={f.id} f={f} lang={lang} onNav={setNavTo} onOpen={() => setPage(f)} coord={coords[f.id]} km={pos && coords[f.id] ? distanceMeters(pos, coords[f.id]) / 1000 : undefined} />
          ))}
        </div>
      )}
      <p className="text-center text-xs text-[var(--hint)]">
        {L.hotline}{" "}
        <a href={`tel:${HOTLINE.phone}`} className="font-semibold text-[var(--link)]">
          {HOTLINE.phone}
        </a>{" "}
        — {lang === "uz" ? HOTLINE.uz : HOTLINE.ru}
      </p>
    </div>
  );
}
