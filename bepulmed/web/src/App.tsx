import { useEffect, useState } from "react";
import { Admin } from "./components/Admin";
import { DoctorsEditor } from "./components/DoctorsEditor";
import { Booking } from "./components/Booking";
import { Chat } from "./components/Chat";
import { EmergencyBar } from "./components/Emergency";
import { MapTab } from "./components/MapTab";
import { Medicines } from "./components/Medicines";
import { MedicalScanner } from "./components/MedicalScanner";
import { Tickets } from "./components/Tickets";
import { Sos } from "./components/Sos";
import { Directory } from "./components/Directory";
import { FirstAid } from "./components/FirstAid";
import { Home } from "./components/Home";
import { VoiceAssistant, type Nav } from "./components/VoiceAssistant";
import { ServerSetup } from "./components/ServerSetup";
import { getHealth, isAndroidApp, savedServer, type Health, type Specialty } from "./lib/api";
import { t, type Lang } from "./lib/i18n";
import { detectLang, haptic } from "./lib/telegram";
import { OfflineReady } from "./components/OfflineReady";
import { Dmed } from "./components/Dmed";
import { Privacy } from "./components/Privacy";
import { useOnline } from "./lib/net";
import { startAutoSync, type SyncReport } from "./lib/sync";

type Tab = "home" | "firstaid" | "chat" | "map" | "book" | "tickets" | "meds" | "scanner" | "sos" | "offline" | "dmed" | "privacy" | "server";

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHashRoute();
  if (hash.startsWith("#/admin/doctors")) return <DoctorsEditor />;
  if (hash.startsWith("#/admin")) return <Admin />;
  return <PatientApp />;
}

function PatientApp() {
  const [lang, setLang] = useState<Lang>(detectLang);
  // В Android-приложении без сервера открываем настройку подключения.
  // Старт — главный экран с кнопкой помощника (настройка сервера — из жёлтой плашки или меню).
  const [tab, setTab] = useState<Tab>("home");
  const online = useOnline();
  const [syncToast, setSyncToast] = useState<SyncReport | null>(null);
  // Автообновление данных при запуске и при появлении интернета.
  useEffect(() => {
    const stop = startAutoSync();
    const on = (e: Event) => {
      setSyncToast((e as CustomEvent<SyncReport>).detail);
      setTimeout(() => setSyncToast(null), 5000);
    };
    window.addEventListener("bm-sync", on);
    return () => {
      stop();
      window.removeEventListener("bm-sync", on);
    };
  }, []);
  const [serverDown, setServerDown] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState<false | { auto?: boolean; text?: string; k: number }>(false);
  const [aidOpen, setAidOpen] = useState<{ id?: string; query?: string; n: number } | undefined>();
  const [nearReq, setNearReq] = useState<number | undefined>();
  const [medsQuery, setMedsQuery] = useState<{ text: string; n: number } | undefined>();
  const [dirQuery, setDirQuery] = useState<{ text: string; n: number } | undefined>();
  const [osmMap, setOsmMap] = useState(false);
  const [openNowReq, setOpenNowReq] = useState<{ kind: "pharmacy" | "all"; n: number } | undefined>(undefined);

  const navigate = (n: Nav) => {
    if (n.tab === "meds" && n.query) setMedsQuery({ text: n.query, n: Date.now() });
    if (n.tab === "map") {
      setOsmMap(Boolean(n.pharmacy));
      if (n.openNow) setOpenNowReq({ kind: n.pharmacy ? "pharmacy" : "all", n: Date.now() });
      if (n.query) setDirQuery({ text: n.query, n: Date.now() });
      if (n.near) setNearReq(Date.now());
    }
    if (n.tab === "firstaid") setAidOpen({ id: n.aidId, query: n.query, n: Date.now() });
    setTab(n.tab);
  };
  const [specialty, setSpecialty] = useState<Specialty | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [ticketsKey, setTicketsKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const L = t(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem("bm_lang", lang);
    } catch {
      /* хранилище недоступно */
    }
  }, [lang]);

  // Данные Ташкента: встроенный снимок + автообновление при появлении интернета — см. startAutoSync выше.

  useEffect(() => {
    if (isAndroidApp && !savedServer()) return setServerDown(true);
    getHealth()
      .then((h) => {
        setHealth(h);
        setServerDown(false);
      })
      .catch(() => {
        setHealth(null);
        setServerDown(true);
      });
  }, []);

  const goBook = (s: Specialty | null) => {
    setSpecialty(s);
    setTab("book");
  };

  const scannerLabel = lang === "ru" ? "Сканер" : "Skaner";
  const menuItems: { id: Tab; label: string; icon: string }[] = [
    { id: "home", label: lang === "ru" ? "Главная" : "Bosh sahifa", icon: "🏠" },
    { id: "firstaid", label: lang === "ru" ? "Скорая помощь (первая помощь)" : "Tez yordam (birinchi yordam)", icon: "🚑" },
    { id: "chat", label: L.tabChat, icon: "💬" },
    { id: "scanner", label: lang === "ru" ? "Умный сканер рецептов и анализов" : "Retsept va tahlillar skaneri", icon: "🧾" },
    { id: "map", label: lang === "ru" ? "Клиники Ташкента" : "Toshkent klinikalari", icon: "🏥" },
    { id: "book", label: L.tabBook, icon: "📅" },
    { id: "tickets", label: L.tabTickets, icon: "🎫" },
    { id: "meds", label: lang === "ru" ? "Бесплатные лекарства" : "Bepul dorilar", icon: "💊" },
    { id: "sos", label: lang === "ru" ? "SOS и медкарта" : "SOS va tibbiy karta", icon: "🆘" },
    { id: "offline", label: lang === "ru" ? "Офлайн-готовность" : "Oflayn tayyorlik", icon: "📴" },
    { id: "dmed", label: "DMED", icon: "🪪" },
    { id: "privacy", label: lang === "ru" ? "Защита данных" : "Ma’lumotlar himoyasi", icon: "🔒" },
    ...(isAndroidApp ? [{ id: "server" as Tab, label: lang === "ru" ? "Сервер" : "Server", icon: "⚙️" }] : []),
  ];
  const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: "home", icon: "🏠", label: lang === "ru" ? "Главная" : "Bosh" },
    { id: "firstaid", icon: "🚑", label: lang === "ru" ? "Скорая" : "Tez yordam" },
    { id: "map", icon: "🏥", label: lang === "ru" ? "Клиники" : "Klinikalar" },
    { id: "meds", icon: "💊", label: L.tabMeds },
    { id: "book", icon: "📅", label: L.tabBook },
    { id: "scanner", icon: "🧾", label: scannerLabel },
  ];

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col">
      <EmergencyBar lang={lang} onSos={() => setTab("sos")} />
      <header className="relative z-20 flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            aria-label={lang === "ru" ? "Открыть меню" : "Menyuni ochish"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-black/10 text-xl"
          >☰</button>
          <div className="min-w-0">
            <div className="text-lg leading-tight font-bold">
              Bepul<span className="text-[var(--link)]">Med</span> AI
            </div>
            <div className="truncate text-xs text-[var(--hint)]">{L.tagline}</div>
          </div>
        </div>
        {syncToast && (
          <div className="fixed left-1/2 top-12 z-[1100] -translate-x-1/2 rounded-full bg-emerald-700 px-3 py-1.5 text-xs text-white shadow" data-testid="sync-toast">
            🔄 {lang === "ru" ? "Данные обновлены" : "Ma’lumotlar yangilandi"}
            {syncToast.places ? ` · ${lang === "ru" ? "аптек и клиник" : "dorixona va klinika"}: ${syncToast.places}` : ""}
          </div>
        )}
        {!online && (
          <button onClick={() => setTab("offline")} className="ml-auto shrink-0 rounded-full bg-gray-200 px-2 py-1 text-[10px] font-medium text-gray-700" data-testid="net-offline">
            📴 {lang === "ru" ? "Офлайн" : "Oflayn"}
          </button>
        )}
        <button
          onClick={() => setVoiceOpen({ auto: true, k: Date.now() })}
          aria-label={lang === "ru" ? "Голосовой помощник" : "Ovozli yordamchi"}
          className={`${online ? "ml-auto " : ""}grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--btn)] text-lg text-[var(--btn-text)] shadow`}
          data-testid="voice-btn"
        >
          🎙️
        </button>
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-black/15 text-xs">
          {(["uz", "ru"] as const).map((l) => (
            <button key={l} onClick={() => setLang(l)} className={`px-2.5 py-1 ${lang === l ? "bg-[var(--btn)] text-[var(--btn-text)]" : ""}`}>
              {l === "uz" ? "O‘Z" : "RU"}
            </button>
          ))}
        </div>
        {menuOpen && (
          <>
            <button aria-label={lang === "ru" ? "Закрыть меню" : "Menyuni yopish"} className="fixed inset-0 z-30 cursor-default" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-3 top-14 z-40 w-[min(19rem,calc(100vw-1.5rem))] rounded-2xl border border-black/10 bg-[var(--bg)] p-2 shadow-xl">
              <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--hint)]">BepulMed AI</div>
              {menuItems.map((item) => (
                <button key={item.id} onClick={() => { setTab(item.id); setMenuOpen(false); haptic(); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm ${tab === item.id ? "bg-[var(--card)] font-semibold text-[var(--link)]" : ""}`}>
                  <span className="text-lg">{item.icon}</span><span>{item.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </header>

      {serverDown && !["server", "sos", "home", "firstaid", "map", "meds", "scanner", "offline", "dmed", "privacy"].includes(tab) && (
        <button onClick={() => setTab(isAndroidApp ? "server" : "sos")} className="bg-amber-100 px-3 py-1.5 text-left text-xs text-amber-900" data-testid="server-down">
          ⚠️{" "}
          {lang === "ru"
            ? "Нет связи с сервером: запись и талоны недоступны. Карта Ташкента, помощник, сканер, SOS и медкарта работают."
            : "Server bilan aloqa yo‘q: yozilish va talonlar ishlamaydi. Toshkent xaritasi, yordamchi, skaner, SOS va tibbiy karta ishlaydi."}
          {isAndroidApp && <u className="ml-1">{lang === "ru" ? "Настроить" : "Sozlash"}</u>}
        </button>
      )}

      {/* Вкладки не размонтируются — сохраняются переписка и выбор. */}
      <main className="relative min-h-0 flex-1">
        <section className={tab === "home" ? "h-full" : "hidden"}>
          <Home
            lang={lang}
            onTalk={() => setVoiceOpen({ auto: true, k: Date.now() })}
            onAsk={(text) => setVoiceOpen({ text, k: Date.now() })}
            onGo={(t) => {
              haptic();
              setTab(t);
            }}
          />
        </section>
        <section className={tab === "firstaid" ? "h-full" : "hidden"}>
          <FirstAid lang={lang} open={aidOpen} />
        </section>
        <section className={tab === "chat" ? "h-full" : "hidden"}>
          <Chat lang={lang} voice={Boolean(health?.voice)} onBook={goBook} />
        </section>
        <section className={tab === "map" ? "h-full" : "hidden"}>
          {osmMap ? (
            <div className="flex h-full flex-col">
              <button onClick={() => setOsmMap(false)} className="px-3 py-1.5 text-left text-xs text-[var(--link)] underline">
                ← {lang === "ru" ? "Справочник клиник Ташкента" : "Toshkent klinikalari ma’lumotnomasi"}
              </button>
              <div className="min-h-0 flex-1">
                <MapTab lang={lang} visible={tab === "map" && osmMap} onBook={() => goBook(null)} openNowReq={openNowReq} />
              </div>
            </div>
          ) : (
            <Directory lang={lang} query={dirQuery} near={nearReq} onShowMap={() => setOsmMap(true)} />
          )}
        </section>
        <section className={tab === "book" ? "h-full" : "hidden"}>
          <Booking
            lang={lang}
            visible={tab === "book"}
            specialty={specialty}
            onSpecialty={setSpecialty}
            onBooked={() => {
              setTicketsKey((k) => k + 1);
              setTab("tickets");
            }}
          />
        </section>
        <section className={tab === "tickets" ? "h-full" : "hidden"}>
          <Tickets lang={lang} visible={tab === "tickets"} refreshKey={ticketsKey} />
        </section>
        <section className={tab === "meds" ? "h-full" : "hidden"}>
          <Medicines lang={lang} query={medsQuery} onPharmacies={() => navigate({ tab: "map", pharmacy: true, openNow: true })} />
        </section>
        <section className={tab === "scanner" ? "h-full" : "hidden"}>
          <MedicalScanner lang={lang} onSos={() => setTab("sos")} onFindDoctor={(q) => navigate({ tab: "map", query: q })} />
        </section>
        <section className={tab === "dmed" ? "h-full" : "hidden"}>
          <Dmed lang={lang} onOpen={() => setTab("dmed")} />
        </section>
        <section className={tab === "privacy" ? "h-full" : "hidden"}>
          <Privacy lang={lang} visible={tab === "privacy"} />
        </section>
        <section className={tab === "offline" ? "h-full" : "hidden"}>
          <OfflineReady lang={lang} visible={tab === "offline"} />
        </section>
        <section className={tab === "sos" ? "h-full" : "hidden"}>
          <Sos lang={lang} visible={tab === "sos"} />
        </section>
        {isAndroidApp && (
          <section className={tab === "server" ? "h-full overflow-y-auto" : "hidden"}>
            <ServerSetup lang={lang} />
          </section>
        )}
      </main>

      {voiceOpen && (
        <VoiceAssistant
          key={voiceOpen.k}
          lang={lang}
          autoListen={voiceOpen.auto}
          initialText={voiceOpen.text}
          onClose={() => setVoiceOpen(false)}
          onNavigate={navigate}
          onSetLang={setLang}
        />
      )}
      <nav className="grid grid-cols-6 border-t border-black/10 pb-[env(safe-area-inset-bottom)]">
        {tabs.map((x) => (
          <button
            key={x.id}
            onClick={() => {
              haptic();
              setTab(x.id);
            }}
            className={`flex flex-col items-center py-2 text-[10px] ${tab === x.id ? "font-semibold text-[var(--link)]" : "text-[var(--hint)]"}`}
          >
            <span className="text-lg leading-none">{x.icon}</span>
            {x.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
