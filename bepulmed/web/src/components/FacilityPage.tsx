import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { SPECIALTIES, type DoctorPublic, type Specialty } from "../../../worker/src/doctors";
import { openStatus, parseOsmHours, statusText, weekText } from "../../../worker/src/hours";
import { DISTRICTS, type TkFacility } from "../data/tashkentFacilities";
import { loadCoords } from "../lib/coords";
import { cachedDoctors, loadDoctors, type FacilityDoctors } from "../lib/doctorsDirectory";
import { telHref } from "../lib/geo";
import type { Lang } from "../lib/i18n";
import { useOnline } from "../lib/net";
import { loadTashkentCache } from "../lib/offline";
import { openLink } from "../lib/telegram";
import { Navigate, type NavTarget } from "./Navigate";
import { PlaceOnline } from "./PlaceExtras";

const TYPE: Record<TkFacility["type"], [string, string]> = {
  family: ["Семейная поликлиника", "Oilaviy poliklinika"],
  central: ["Центральная многопрофильная поликлиника района", "Tuman markaziy ko‘p tarmoqli poliklinikasi"],
  specialized: ["Специализированный центр", "Ixtisoslashgan markaz"],
  emergency: ["Экстренная помощь 24/7", "Shoshilinch yordam 24/7"],
  other: ["Медицинское учреждение", "Tibbiyot muassasasi"],
};

const dt = (iso: string | number) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

function DoctorRow({ d, lang, now }: { d: DoctorPublic; lang: Lang; now: number }) {
  const ru = lang === "ru";
  const st = d.week ? openStatus(d.week, now) : null;
  return (
    <li className="border-t border-black/5 py-2 first:border-0" data-testid="doctor">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{d.name}</div>
          <div className="text-xs text-[var(--hint)]">
            {SPECIALTIES[d.specialty][ru ? "ru" : "uz"]}
            {d.room ? ` · ${ru ? "каб." : "xona"} ${d.room}` : ""}
          </div>
        </div>
        {st && (
          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] ${st.open ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-700"}`} data-testid="doctor-status" data-open={st.open}>
            {st.open ? (ru ? `🟢 Принимает до ${st.allDay ? "24:00" : st.until}` : `🟢 ${st.allDay ? "24:00" : st.until} gacha qabul`) : `⚪ ${statusText(st, lang).replace(/^Закрыто · откроется/, "Приём").replace(/^Yopiq · /, "Qabul: ")}`}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-xs" data-testid="doctor-week">
        🕒 {d.week ? weekText(d.week, lang) : ru ? "часы приёма не указаны" : "qabul vaqti ko‘rsatilmagan"}
      </div>
    </li>
  );
}

/** Страница поликлиники: контакты, режим, навигация, врачи по специальностям и часы приёма, отзывы. */
export function FacilityPage({ f, lang, onClose, initialSpecialty }: { f: TkFacility; lang: Lang; onClose: () => void; initialSpecialty?: Specialty | null }) {
  const ru = lang === "ru";
  const online = useOnline();
  const name = ru ? f.ru : f.uz;
  const coord = loadCoords()[f.id];
  const osm = useMemo(() => (coord?.osm ? loadTashkentCache()?.elements.find((e) => `${e.type}/${e.id}` === coord.osm) : undefined), [coord?.osm]);
  const hours = osm?.tags?.opening_hours;
  const week = parseOsmHours(hours);
  const now = Date.now();
  const [data, setData] = useState<FacilityDoctors | null>(() => cachedDoctors(f.id));
  const [busy, setBusy] = useState(false);
  const [spec, setSpec] = useState<Specialty | "all">(initialSpecialty ?? "all");
  const [nav, setNav] = useState<NavTarget | null>(null);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    void loadDoctors(f.id, f.ru).then((d) => {
      if (!alive) return;
      setData(d);
      setBusy(false);
    });
    return () => {
      alive = false;
    };
  }, [f.id, f.ru, online]);

  const doctors = data?.doctors ?? [];
  const specs = [...new Set(doctors.map((d) => d.specialty))];
  const shown = doctors.filter((d) => spec === "all" || d.specialty === spec);
  const phones = [...(f.phones ?? []), ...(osm?.tags?.phone && !(f.phones ?? []).some((p) => p.replace(/\D/g, "").endsWith(osm.tags!.phone!.replace(/\D/g, "").slice(-7))) ? [osm.tags.phone] : [])];
  const district = f.district ? DISTRICTS[f.district] : null;

  function openNav() {
    const c = coord ?? (district ? { lat: district.lat, lon: district.lon } : { lat: 41.2995, lon: 69.2401 });
    setNav({ name, lat: c.lat, lon: c.lon, address: f.address, phone: phones[0], approx: !coord });
  }

  return createPortal(
    <div className="fixed inset-0 z-[900] flex flex-col" style={{ background: "var(--bg)" }} data-testid="facility-page">
      {nav && <Navigate to={nav} lang={lang} onClose={() => setNav(null)} />}
      <div className="flex items-center gap-2 border-b border-black/10 p-2">
        <button onClick={onClose} className="rounded-lg px-2 py-1 text-lg" aria-label={ru ? "Назад" : "Orqaga"} data-testid="facility-back">
          ←
        </button>
        <div className="min-w-0 flex-1 truncate font-semibold">{name}</div>
        {!online && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px]">📴 {ru ? "офлайн" : "oflayn"}</span>}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        <div>
          <div className="text-xs text-[var(--hint)]">
            {TYPE[f.type][ru ? 0 : 1]}
            {district ? ` · ${ru ? district.ru + " район" : district.uz}` : ""}
          </div>
          <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
            <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-sky-800">🏛 {ru ? "Гос. · бесплатно по прикреплению" : "Davlat · biriktirilganlarga bepul"}</span>
            {week && (
              <span className={`rounded-md px-1.5 py-0.5 ${openStatus(week, now).open ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-700"}`} data-testid="facility-open">
                {statusText(openStatus(week, now), lang)}
              </span>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-[var(--card)] p-3">
          <div>📍 {f.address}</div>
          {phones.map((p) => (
            <a key={p} href={telHref(p) ?? `tel:${p}`} className="mt-1 block text-[var(--link)] underline">
              📞 {p}
            </a>
          ))}
          {!phones.length && <div className="mt-1 text-xs text-[var(--hint)]">{ru ? "Телефон не указан — единая справочная Минздрава 1003" : "Telefon ko‘rsatilmagan — SSV ishonch telefoni 1003"}</div>}
          <div className="mt-2 flex gap-2">
            <button onClick={openNav} className="flex-1 rounded-xl bg-[var(--btn)] py-2 text-xs font-medium text-[var(--btn-text)]" data-testid="facility-nav">
              🧭 {ru ? "Навигация" : "Navigatsiya"}
            </button>
            {phones[0] && (
              <a href={telHref(phones[0]) ?? `tel:${phones[0]}`} className="flex-1 rounded-xl border border-[var(--btn)] py-2 text-center text-xs text-[var(--link)]">
                📞 {ru ? "Регистратура" : "Registratura"}
              </a>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-[var(--card)] p-3" data-testid="facility-hours">
          <div className="font-medium">🕒 {ru ? "Режим работы" : "Ish vaqti"}</div>
          {week ? (
            <div className="mt-1 text-xs">
              {weekText(week, lang)} <span className="text-[var(--hint)]">({ru ? "OpenStreetMap" : "OpenStreetMap"})</span>
            </div>
          ) : (
            <div className="mt-1 text-xs text-[var(--hint)]">{ru ? "Часы этой поликлиники в открытых данных не указаны — уточните в регистратуре." : "Ochiq ma’lumotlarda ish vaqti yo‘q — registraturadan aniqlang."}</div>
          )}
          {(f.type === "family" || f.type === "central") && (
            <div className="mt-1 text-[11px] text-[var(--hint)]">
              {ru
                ? "По постановлению 2022 г. дневные стационары семейных и центральных многопрофильных поликлиник работают до 20:00."
                : "2022-yilgi qarorga ko‘ra oilaviy va markaziy ko‘p tarmoqli poliklinikalarning kunduzgi statsionarlari 20:00 gacha ishlaydi."}
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-[var(--card)] p-3" data-testid="facility-doctors">
          <div className="flex items-center justify-between">
            <div className="font-medium">👩‍⚕️ {ru ? "Врачи и часы приёма" : "Shifokorlar va qabul vaqti"}</div>
            {busy && <span className="text-[10px] text-[var(--hint)]">…</span>}
          </div>
          {doctors.length > 0 && (
            <>
              <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
                {(["all", ...specs] as (Specialty | "all")[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setSpec(k)}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${spec === k ? "bg-[var(--btn)] text-[var(--btn-text)]" : "bg-white"}`}
                    data-testid={`spec-${k}`}
                  >
                    {k === "all" ? (ru ? "Все" : "Hammasi") : SPECIALTIES[k][ru ? "ru" : "uz"]}
                  </button>
                ))}
              </div>
              {spec !== "all" && !shown.length && <p className="text-xs">{ru ? "Нет врача этой специальности." : "Bu mutaxassis yo‘q."}</p>}
              <ul>{shown.map((d) => <DoctorRow key={d.id} d={d} lang={lang} now={now} />)}</ul>
              {spec !== "all" && SPECIALTIES[spec].referral && (
                <p className="mt-1 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">
                  {ru ? "К этому специалисту — по направлению семейного врача." : "Bu mutaxassisga — oilaviy shifokor yo‘llanmasi bilan."}
                </p>
              )}
              <p className="mt-1 text-[10px] text-[var(--hint)]" data-testid="doctors-source">
                {data?.source === "dmed" ? (ru ? "Источник: DMED" : "Manba: DMED") : ru ? "Опубликовано регистратурой в BepulMed" : "BepulMed’da registratura e’lon qilgan"}
                {data?.checkedAt ? ` · ${ru ? "проверено" : "tekshirilgan"} ${dt(data.checkedAt)}` : ""}
                {data?.offline && data.savedAt ? ` · ${ru ? "сохранено" : "saqlangan"} ${dt(data.savedAt)}, ${ru ? "может быть устаревшим" : "eskirgan bo‘lishi mumkin"}` : ""}
              </p>
            </>
          )}
          {!doctors.length && !busy && (
            <div className="mt-1 space-y-1 text-xs" data-testid="doctors-empty">
              <p>{ru ? "Расписание врачей этой поликлиники пока не опубликовано." : "Bu poliklinika shifokorlari jadvali hali e’lon qilinmagan."}</p>
              <p className="text-[var(--hint)]">
                {ru
                  ? "В семейной поликлинике принимают семейный врач, педиатр, акушер-гинеколог; к неврологу, кардиологу и другим узким специалистам — по направлению семейного врача."
                  : "Oilaviy poliklinikada oilaviy shifokor, pediatr, akusher-ginekolog qabul qiladi; nevrolog, kardiolog va boshqa tor mutaxassislarga — oilaviy shifokor yo‘llanmasi bilan."}
              </p>
              <p className="text-[var(--hint)]">
                {ru
                  ? "Расписание появится само, когда поликлиника опубликует его в BepulMed или после входа в DMED. Сейчас — позвоните в регистратуру."
                  : "Jadval poliklinika BepulMed’da e’lon qilganda yoki DMED’ga kirgandan so‘ng o‘zi chiqadi. Hozir — registraturaga qo‘ng‘iroq qiling."}
              </p>
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-[var(--card)] p-3" data-testid="facility-reviews">
          <div className="font-medium">⭐ {ru ? "Отзывы и рейтинг" : "Sharhlar va reyting"}</div>
          <PlaceOnline f={{ name: f.ru, kind: f.type === "emergency" || f.type === "specialized" ? "hospital" : "clinic", lat: coord?.lat, lon: coord?.lon, openingHours: hours }} lang={lang} district={f.district ?? undefined} />
        </div>

        {f.website && (
          <button onClick={() => openLink(f.website!)} className="w-full rounded-xl border border-black/10 py-2 text-xs text-[var(--link)]">
            🌐 {ru ? "Сайт учреждения (откроется в браузере)" : "Muassasa sayti (brauzerda ochiladi)"}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
