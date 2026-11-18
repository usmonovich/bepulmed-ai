import { useCallback, useEffect, useState } from "react";
import { FIRST_AID } from "../data/firstAid";
import { FREE_MEDS } from "../data/freeMeds";
import { TASHKENT_FACILITIES } from "../data/tashkentFacilities";
import { loadCoords } from "../lib/coords";
import { isEmptyCard, loadCard } from "../lib/medcard";
import { useOnline } from "../lib/net";
import { loadTashkentCache } from "../lib/offline";
import { loadTickets } from "../lib/ticketCache";
import { clearTileCache, isNativeApp, nativeCaps, openSpeechSettings, setNetworkSpeech, speechVendor } from "../lib/voice";
import type { Lang } from "../lib/i18n";
import { mapPack, type MapPack } from "../lib/mapPack";
import { syncNow, syncState } from "../lib/sync";

type State = "ok" | "part" | "no";
interface Row {
  id: string;
  icon: string;
  title: string;
  detail: string;
  state: State;
  action?: { label: string; run: () => void };
}

const OCR_FILES = ["worker.min.js", "core/tesseract-core-simd-lstm.wasm.js", "lang/rus.traineddata.gz", "lang/uzb.traineddata.gz", "lang/eng.traineddata.gz"];

async function ocrReady(): Promise<number> {
  const base = `${import.meta.env.BASE_URL}ocr/`;
  const res = await Promise.all(
    OCR_FILES.map((f) =>
      fetch(base + f, { method: "HEAD", cache: "no-store" })
        .then((r) => r.ok)
        .catch(() => false),
    ),
  );
  return res.filter(Boolean).length;
}

const mb = (b: number) => (b / 1048576).toFixed(1);
const when = (iso: string | number) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Экран «Офлайн-готовность»: что работает без интернета прямо сейчас и что докачать, пока есть связь. */
export function OfflineReady({ lang, visible }: { lang: Lang; visible: boolean }) {
  const ru = lang === "ru";
  const online = useOnline();
  const [ocr, setOcr] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [pack, setPack] = useState<MapPack | null | undefined>(undefined);
  useEffect(() => {
    void mapPack().then(setPack);
  }, []);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void ocrReady().then((n) => alive && setOcr(n));
    return () => {
      alive = false;
    };
  }, [visible, tick]);

  async function prepare() {
    if (busy) return;
    setBusy(true);
    setMsg(ru ? "Обновляю данные Ташкента и координаты…" : "Toshkent ma’lumotlari va koordinatalar yangilanmoqda…");
    try {
      const r = await syncNow({ force: true });
      await ocrReady();
      const n = Object.keys(loadCoords()).length;
      setMsg(r.skipped === "offline" ? (ru ? "Нет интернета." : "Internet yo‘q.") : ru ? `Готово. Координаты: ${n} из ${TASHKENT_FACILITIES.length}.` : `Tayyor. Koordinatalar: ${n} / ${TASHKENT_FACILITIES.length}.`);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  const native = isNativeApp();
  const caps = nativeCaps();
  const coords = Object.keys(loadCoords()).length;
  const osm = loadTashkentCache();
  const tickets = loadTickets();
  const card = loadCard();
  const total = TASHKENT_FACILITIES.length;
  void tick;

  const ss = syncState();
  const rows: Row[] = [
    {
      id: "map",
      icon: "🗺️",
      title: ru ? "Карта Ташкента" : "Toshkent xaritasi",
      detail:
        pack === undefined
          ? "…"
          : pack
            ? ru
              ? `Встроена в приложение${pack.test ? " (ТЕСТОВАЯ)" : ""}: ${mb(pack.bytes)} МБ, данные OSM от ${pack.version}, до масштаба ${pack.maxzoom}. Работает без интернета.`
              : `Ilovaga o‘rnatilgan${pack.test ? " (TEST)" : ""}: ${mb(pack.bytes)} MB, OSM ma’lumotlari ${pack.version}. Internetsiz ishlaydi.`
            : ru
              ? "Не встроена в эту сборку — подложка сохраняется по мере просмотра."
              : "Bu yig‘ishda o‘rnatilmagan — ko‘rilgan joylar saqlanadi.",
      state: pack ? "ok" : pack === undefined ? "part" : "part",
    },
    {
      id: "sync",
      icon: "🔄",
      title: ru ? "Автообновление" : "Avto-yangilash",
      detail: ss.lastOk
        ? ru
          ? `Последнее обновление: ${new Date(ss.lastOk).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}. Обновляется само при появлении интернета.`
          : `Oxirgi yangilanish: ${new Date(ss.lastOk).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}. Internet paydo bo‘lganda o‘zi yangilanadi.`
        : ru
          ? "Обновится само при первом подключении к интернету."
          : "Birinchi internet ulanishida o‘zi yangilanadi.",
      state: ss.lastOk ? "ok" : "part",
    },
    {
      id: "aid",
      icon: "🚑",
      title: ru ? "Первая помощь" : "Birinchi yordam",
      detail: ru ? `${FIRST_AID.length} инструкций, поиск по описанию, метроном СЛР` : `${FIRST_AID.length} ta yo‘riqnoma, tavsif bo‘yicha qidiruv, YuO‘R metronomi`,
      state: "ok",
    },
    {
      id: "assistant",
      icon: "🤖",
      title: ru ? "Помощник (текст)" : "Yordamchi (matn)",
      detail: ru ? "Работает на устройстве: триаж, разделы приложения, справка. Не нейросеть — база знаний." : "Qurilmada ishlaydi: triaj, bo‘limlar, ma’lumot. Neyrotarmoq emas — bilimlar bazasi.",
      state: "ok",
    },
    {
      id: "meds",
      icon: "💊",
      title: ru ? "Бесплатные лекарства" : "Bepul dorilar",
      detail: ru ? `${FREE_MEDS.length} позиций, поиск по примерному описанию` : `${FREE_MEDS.length} ta dori, taxminiy tavsif bo‘yicha qidiruv`,
      state: "ok",
    },
    {
      id: "clinics",
      icon: "🏥",
      title: ru ? "Справочник клиник Ташкента" : "Toshkent klinikalari",
      detail: ru
        ? `${total} учреждений в приложении · координаты: ${coords} из ${total}${coords < total ? " (остальные — по адресу и району)" : ""}`
        : `${total} ta muassasa · koordinatalar: ${coords} / ${total}${coords < total ? " (qolganlari — manzil va tuman bo‘yicha)" : ""}`,
      state: coords >= total * 0.8 ? "ok" : "part",
      action: online && coords < total ? { label: ru ? "Докачать" : "Yuklash", run: () => void prepare() } : undefined,
    },
    {
      id: "osm",
      icon: "🗺️",
      title: ru ? "Аптеки и больницы на карте (OSM)" : "Xaritadagi dorixona va shifoxonalar (OSM)",
      detail: osm
        ? ru
          ? `${osm.elements.length} объектов, сохранено ${when(osm.fetchedAt)}`
          : `${osm.elements.length} ta obyekt, saqlangan ${when(osm.fetchedAt)}`
        : ru
          ? "Ещё не загружено — нужен интернет один раз"
          : "Hali yuklanmagan — bir marta internet kerak",
      state: osm ? "ok" : "no",
      action: online ? { label: osm ? (ru ? "Обновить" : "Yangilash") : ru ? "Загрузить" : "Yuklash", run: () => void prepare() } : undefined,
    },
    {
      id: "tiles",
      icon: "🧭",
      title: ru ? "Подложка карты" : "Xarita fon qatlami",
      detail: native
        ? ru
          ? `Сохранено ${caps.tiles ?? 0} фрагментов (${mb(caps.tileBytes ?? 0)} МБ). Без сети видны районы, которые вы уже открывали.`
          : `${caps.tiles ?? 0} ta bo‘lak saqlangan (${mb(caps.tileBytes ?? 0)} MB). Internetsiz avval ochilgan hududlar ko‘rinadi.`
        : ru
          ? "В браузере кэшируются просмотренные фрагменты (если поддерживается)."
          : "Brauzerda ko‘rilgan bo‘laklar keshlanadi (agar qo‘llab-quvvatlansa).",
      state: native ? ((caps.tiles ?? 0) > 20 ? "ok" : "part") : "part",
      action: native && (caps.tiles ?? 0) > 0 ? { label: ru ? "Очистить" : "Tozalash", run: () => { clearTileCache(); refresh(); } } : undefined,
    },
    {
      id: "ocr",
      icon: "🧾",
      title: ru ? "Сканер рецептов (OCR)" : "Retsept skaneri (OCR)",
      detail:
        ocr === null
          ? ru ? "Проверяю…" : "Tekshirilmoqda…"
          : ru
            ? `Модели RU/UZ/EN: ${ocr} из ${OCR_FILES.length} файлов доступны`
            : `RU/UZ/EN modellari: ${ocr} / ${OCR_FILES.length} fayl mavjud`,
      state: ocr === OCR_FILES.length ? "ok" : ocr === null ? "part" : "no",
    },
    {
      id: "voice",
      icon: "🎙️",
      title: ru ? "Голосовой ввод" : "Ovozli kiritish",
      detail: !native
        ? ru
          ? "В браузере отключён: голос не отправляется на внешние серверы. Доступен в приложении для Android и iOS."
          : "Brauzerda o‘chirilgan: ovoz tashqi serverlarga yuborilmaydi. Android va iOS ilovasida mavjud."
        : caps.sttOnDevice
          ? ru
            ? "Распознавание на устройстве — работает без интернета."
            : "Qurilmada aniqlash — internetsiz ishlaydi."
          : caps.netSpeechAllowed
            ? ru
              ? `Через сервис ${speechVendor()} (нужен интернет). Скачайте офлайн-пакет языка, чтобы работало без сети.`
              : `${speechVendor()} xizmati orqali (internet kerak). Internetsiz ishlashi uchun til paketini yuklang.`
            : ru
              ? `Офлайн-пакет речи не найден. Скачайте пакет «Русский» в настройках голосового ввода или разрешите распознавание ${speechVendor()}.`
              : `Nutq paketi topilmadi. Ovozli kiritish sozlamalarida «Rus» paketini yuklang yoki ${speechVendor()} aniqlashiga ruxsat bering.`,
      state: native && caps.sttOnDevice ? "ok" : native && caps.netSpeechAllowed ? "part" : "no",
      action: native ? { label: ru ? "Офлайн-пакет" : "Paket", run: () => openSpeechSettings() } : undefined,
    },
    {
      id: "tts",
      icon: "🔊",
      title: ru ? "Озвучивание ответов" : "Javoblarni ovozlash",
      detail: native
        ? caps.tts
          ? ru
            ? `Синтез речи телефона${caps.ttsUz ? " (есть узбекский)" : " (узбекского голоса нет — читаем по-русски)"}`
            : `Telefon nutq sintezi${caps.ttsUz ? " (o‘zbekcha bor)" : " (o‘zbek ovozi yo‘q — ruscha o‘qiladi)"}`
          : ru ? "Синтез речи не найден на телефоне" : "Telefonda nutq sintezi topilmadi"
        : ru ? "Только в приложении для Android и iOS" : "Faqat Android va iOS ilovasida",
      state: native && caps.tts ? "ok" : "no",
    },
    {
      id: "sos",
      icon: "🆘",
      title: ru ? "SOS и медкарта" : "SOS va tibbiy karta",
      detail: isEmptyCard(card)
        ? ru ? "Номера 103/112 работают всегда. Медкарта не заполнена." : "103/112 doim ishlaydi. Tibbiy karta to‘ldirilmagan."
        : ru ? "Медкарта сохранена на устройстве, 103/112 — без интернета" : "Tibbiy karta qurilmada saqlangan, 103/112 — internetsiz",
      state: isEmptyCard(card) ? "part" : "ok",
    },
    {
      id: "tickets",
      icon: "🎫",
      title: ru ? "Талоны и QR" : "Talonlar va QR",
      detail: tickets
        ? ru
          ? `Сохранено ${tickets.appointments.length} талон(ов) от ${when(tickets.at)}; QR строится без сети`
          : `${tickets.appointments.length} ta talon saqlangan (${when(tickets.at)}); QR internetsiz`
        : ru
          ? "Запись требует сервера; после первой загрузки талоны доступны офлайн"
          : "Yozilish server talab qiladi; birinchi yuklashdan so‘ng talonlar oflayn",
      state: tickets ? "ok" : "part",
    },
  ];

  const ready = rows.filter((r) => r.state === "ok").length;
  const dot: Record<State, string> = { ok: "bg-emerald-500", part: "bg-amber-400", no: "bg-red-400" };

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3 text-sm" data-testid="offline-ready">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{ru ? "Офлайн-готовность" : "Oflayn tayyorlik"}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${online ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-700"}`}>
          {online ? (ru ? "● В сети" : "● Onlayn") : ru ? "○ Без сети" : "○ Oflayn"}
        </span>
      </div>
      <p className="text-xs text-[var(--hint)]">
        {ru
          ? `Готово к работе без интернета: ${ready} из ${rows.length}. Данные хранятся только на этом устройстве.`
          : `Internetsiz ishlashga tayyor: ${ready} / ${rows.length}. Ma’lumotlar faqat shu qurilmada saqlanadi.`}
      </p>
      {online && (
        <button disabled={busy} onClick={() => void prepare()} className="w-full rounded-xl bg-[var(--btn)] py-2.5 font-medium text-[var(--btn-text)] disabled:opacity-50" data-testid="offline-prepare">
          {busy ? "…" : ru ? "⬇️ Подготовить к работе без интернета" : "⬇️ Internetsiz ishlashga tayyorlash"}
        </button>
      )}
      {msg && <p className="text-xs">{msg}</p>}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start gap-3 rounded-2xl bg-[var(--card)] p-3" data-testid={`ready-${r.id}`} data-state={r.state}>
            <span className="text-xl">{r.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-medium">
                <span className={`h-2 w-2 shrink-0 rounded-full ${dot[r.state]}`} />
                {r.title}
              </div>
              <div className="text-xs text-[var(--hint)]">{r.detail}</div>
            </div>
            {r.action && (
              <button onClick={r.action.run} className="shrink-0 rounded-lg border border-black/15 px-2 py-1 text-xs">
                {r.action.label}
              </button>
            )}
          </li>
        ))}
      </ul>
      {native && !caps.sttOnDevice && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={caps.netSpeechAllowed}
            onChange={(e) => {
              setNetworkSpeech(e.target.checked);
              refresh();
            }}
          />
          {ru ? `Разрешить распознавание речи через ${speechVendor()}, если нет офлайн-пакета` : `Oflayn paket bo‘lmasa, ${speechVendor()} orqali nutqni aniqlashga ruxsat`}
        </label>
      )}
    </div>
  );
}
