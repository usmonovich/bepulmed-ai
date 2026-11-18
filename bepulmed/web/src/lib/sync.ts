// Автообновление данных: при запуске, при появлении интернета и при возвращении в приложение.
// Обновляется то, что может устареть: аптеки и клиники Ташкента (часы, телефоны), координаты учреждений.
// Без интернета ничего не делает — приложение работает на сохранённом.
import { ensureCoords, loadCoords } from "./coords";
import { loadTashkentCache, primeFromBundle, refreshTashkent } from "./offline";
import { TASHKENT_FACILITIES } from "../data/tashkentFacilities";

const KEY = "bm_sync_v1";
const OSM_EVERY = 3 * 24 * 3600 * 1000; // часы и телефоны меняются нечасто
const MIN_GAP = 30 * 60 * 1000; // не чаще раза в 30 минут

export interface SyncState {
  lastTry?: number;
  lastOk?: number;
  osmAt?: string;
  places?: number;
  coords?: number;
  error?: string;
}

export function syncState(): SyncState {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as SyncState;
  } catch {
    return {};
  }
}
function save(s: SyncState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export interface SyncReport {
  updated: boolean;
  places?: number;
  coords?: number;
  skipped?: "offline" | "recent" | "running";
}

let running: Promise<SyncReport> | null = null;

export function syncNow(opts: { force?: boolean; now?: number; online?: boolean; refresh?: typeof refreshTashkent } = {}): Promise<SyncReport> {
  if (running) return Promise.resolve({ updated: false, skipped: "running" });
  const now = opts.now ?? Date.now();
  const online = opts.online ?? (typeof navigator === "undefined" || navigator.onLine !== false);
  const st = syncState();
  if (!online) return Promise.resolve({ updated: false, skipped: "offline" });
  if (!opts.force && st.lastTry && now - st.lastTry < MIN_GAP) return Promise.resolve({ updated: false, skipped: "recent" });
  running = (async (): Promise<SyncReport> => {
    save({ ...st, lastTry: now });
    await primeFromBundle().catch(() => null);
    const cache = loadTashkentCache();
    let updated = false;
    let places: number | undefined;
    const stale = !cache || now - Date.parse(cache.fetchedAt) > OSM_EVERY;
    if (opts.force || stale) {
      try {
        const c = await (opts.refresh ?? refreshTashkent)();
        places = c.elements.length;
        updated = true;
      } catch (e) {
        save({ ...syncState(), error: String((e as Error).message ?? e) });
      }
    }
    const before = Object.keys(loadCoords()).length;
    let coords = before;
    if (before < TASHKENT_FACILITIES.length) coords = await ensureCoords().catch(() => before);
    if (coords > before) updated = true;
    const c2 = loadTashkentCache();
    save({ ...syncState(), lastOk: now, osmAt: c2?.fetchedAt, places: c2?.elements.length, coords, error: updated ? undefined : syncState().error });
    const rep: SyncReport = { updated, places, coords: coords > before ? coords - before : undefined };
    if (updated && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("bm-sync", { detail: rep }));
    return rep;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Подписка: старт, «появился интернет», «вернулись в приложение». */
export function startAutoSync(): () => void {
  const kick = () => void syncNow();
  const t = setTimeout(kick, 2500);
  const onVis = () => document.visibilityState === "visible" && kick();
  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", onVis);
  return () => {
    clearTimeout(t);
    window.removeEventListener("online", kick);
    document.removeEventListener("visibilitychange", onVis);
  };
}
