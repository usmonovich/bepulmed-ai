// Тонкая обёртка над Telegram WebApp SDK. Вне Telegram (в обычном браузере) всё работает с безопасными заглушками.

interface TgLocation {
  latitude: number;
  longitude: number;
}

interface TgWebApp {
  initData: string;
  initDataUnsafe: { user?: { language_code?: string; first_name?: string } };
  colorScheme?: "light" | "dark";
  ready(): void;
  expand(): void;
  openLink(url: string): void;
  openTelegramLink?(url: string): void;
  isVersionAtLeast?(v: string): boolean;
  HapticFeedback?: { impactOccurred(style: "light" | "medium"): void };
  LocationManager?: {
    isInited: boolean;
    isLocationAvailable: boolean;
    isAccessGranted: boolean;
    init(cb?: () => void): void;
    getLocation(cb: (loc: TgLocation | null) => void): void;
    openSettings(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export const tg: TgWebApp | undefined = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
export const inTelegram = Boolean(tg?.initData);

export function initTelegram(): void {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
  } catch {
    /* старые клиенты */
  }
}

export function openLink(url: string): void {
  if (inTelegram && tg) tg.openLink(url);
  else window.open(url, "_blank", "noopener");
}

export function haptic(): void {
  try {
    tg?.HapticFeedback?.impactOccurred("light");
  } catch {
    /* нет поддержки */
  }
}

export type GeoError = "denied" | "unavailable" | "timeout";

function browserLocation(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject("unavailable" satisfies GeoError);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject((e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable") satisfies GeoError),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

/** Сначала Telegram LocationManager (Bot API 8.0+), затем браузерная геолокация. Всегда с разрешения пользователя. */
export function requestLocation(): Promise<{ lat: number; lon: number }> {
  const lm = tg?.LocationManager;
  const supported = inTelegram && lm && (tg?.isVersionAtLeast?.("8.0") ?? false);
  if (!supported) return browserLocation();
  return new Promise((resolve, reject) => {
    const ask = () => {
      if (!lm.isLocationAvailable) return browserLocation().then(resolve, reject);
      lm.getLocation((loc) => {
        if (loc) resolve({ lat: loc.latitude, lon: loc.longitude });
        else reject("denied" satisfies GeoError);
      });
    };
    if (lm.isInited) ask();
    else lm.init(ask);
  });
}

export function detectLang(): "ru" | "uz" {
  try {
    const saved = localStorage.getItem("bm_lang");
    if (saved === "ru" || saved === "uz") return saved;
  } catch {
    /* хранилище недоступно */
  }
  const code = tg?.initDataUnsafe?.user?.language_code ?? navigator.language;
  return code?.toLowerCase().startsWith("uz") ? "uz" : "ru";
}
