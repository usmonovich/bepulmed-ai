import { describe, it, expect } from "vitest";
import { distanceMeters, formatDistance, routeUrl, telHref } from "./geo";
import { addDays, dayLabel, hhmm, nextDays, todayTashkent } from "./format";
import { DICT } from "./i18n";
import { isMentioned } from "../components/Medicines";
import { stripCitations } from "../components/Chat";
import { mergeFacilities } from "./facilities";
import type { Facility } from "./api";

describe("geo", () => {
  it("расстояние Ташкент → Самарканд ≈ 270 км", () => {
    const d = distanceMeters({ lat: 41.3111, lon: 69.2406 }, { lat: 39.6542, lon: 66.9597 });
    expect(d / 1000).toBeGreaterThan(260);
    expect(d / 1000).toBeLessThan(280);
  });
  it("нулевое расстояние", () => expect(distanceMeters({ lat: 41, lon: 69 }, { lat: 41, lon: 69 })).toBe(0));
  it("формат", () => {
    expect(formatDistance(420.4, "ru")).toBe("420 м");
    expect(formatDistance(1530, "uz")).toBe("1.5 km");
  });
  it("маршрут с точкой старта и без", () => {
    expect(routeUrl({ lat: 41, lon: 69 }, { lat: 41.1, lon: 69.1 })).toBe("https://yandex.uz/maps/?rtext=41.000000%2C69.000000~41.100000%2C69.100000&rtt=auto");
    expect(routeUrl(null, { lat: 41.1, lon: 69.1 })).toContain("rtext=~41.1");
  });
  it("tel: ссылки", () => {
    expect(telHref("+998 (71) 123-45-67")).toBe("tel:+998711234567");
    expect(telHref("+998 71 111 11 11; +998 90 000 00 00")).toBe("tel:+998711111111");
    expect(telHref("нет")).toBeNull();
  });
});

describe("формат времени (Ташкент)", () => {
  it("часы и дата по Ташкенту независимо от пояса устройства", () => {
    expect(hhmm("2026-11-18T04:00:00.000Z")).toBe("09:00");
    expect(todayTashkent(new Date("2026-11-17T19:30:00Z"))).toBe("2026-11-18");
  });
  it("7 дней подряд и подписи", () => {
    const d = nextDays(7, new Date("2026-11-17T06:00:00Z"));
    expect(d[0]).toBe("2026-11-17");
    expect(d[6]).toBe(addDays("2026-11-17", 6));
    expect(dayLabel("2026-11-17", "ru")).toEqual({ weekday: "Вт", day: "17.11" });
    expect(dayLabel("2026-11-22", "uz").weekday).toBe("Ya");
  });
});

describe("i18n", () => {
  it("одинаковые ключи и непустые значения в ru/uz", () => {
    expect(Object.keys(DICT.uz).sort()).toEqual(Object.keys(DICT.ru).sort());
    for (const lang of ["ru", "uz"] as const)
      for (const [k, v] of Object.entries(DICT[lang])) expect(String(v).length > 0, `${lang}.${k}`).toBe(true);
  });
});

describe("лекарства", () => {
  it("поиск упомянутых препаратов", () => {
    expect(isMentioned("Бисопролол")).toBe(true);
    expect(isMentioned("geparin")).toBe(true);
    expect(isMentioned("аспирин кардио 100")).toBe(true);
    expect(isMentioned("парацетамол")).toBe(false);
    expect(isMentioned("ас")).toBeNull();
  });
});

describe("чат и карта", () => {
  it("удаляет [id] ссылки", () => expect(stripCitations("Текст [km-382]. Ещё [pp-311]")).toBe("Текст. Ещё"));
  it("слияние: проверенные первыми, дубли OSM убираются, сортировка по расстоянию", () => {
    const at = { lat: 41.3, lon: 69.24 };
    const mk = (id: string, lat: number, kind: Facility["kind"], verified = false): Facility => ({ id, name: id, kind, lat, lon: 69.24, source: verified ? "verified" : "osm", verified });
    const osm = [mk("far", 41.32, "clinic"), mk("dup", 41.3002, "clinic"), mk("near", 41.301, "pharmacy")];
    const ver = [mk("v1", 41.3001, "clinic", true), mk("vfar", 42, "clinic", true)];
    const r = mergeFacilities(osm, ver, at, 3000).map((f) => f.id);
    expect(r).toEqual(["v1", "near", "far"]);
  });
});

import { cleanPhone, EMPTY_CARD, isEmptyCard, loadCard, mapsLink, saveCard, sosMessage } from "./medcard";
import { normalizeServer } from "./api";

describe("медкарта и SOS", () => {
  it("телефон очищается для tel:/sms:", () => {
    expect(cleanPhone("+998 (90) 123-45-67")).toBe("+998901234567");
    expect(cleanPhone("90+123")).toBe("90123");
  });
  it("сообщение содержит ссылку на карту и данные медкарты", () => {
    const m = sosMessage("ru", { ...EMPTY_CARD, name: "Алишер", bloodType: "A(II) Rh+", allergies: "пенициллин" }, { lat: 41.31, lon: 69.28 });
    expect(m).toContain("https://maps.google.com/?q=41.310000,69.280000");
    expect(m).toContain("Группа крови: A(II) Rh+");
    expect(m).toContain("Аллергия: пенициллин");
    expect(sosMessage("uz", EMPTY_CARD, null)).toContain("Joylashuvni aniqlab bo‘lmadi");
    expect(mapsLink(1, 2)).toBe("https://maps.google.com/?q=1.000000,2.000000");
  });
  it("сохранение без сервера: обрезка и восстановление", () => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
    expect(isEmptyCard(loadCard())).toBe(true);
    saveCard({ ...EMPTY_CARD, allergies: "  x".repeat(200) });
    expect(loadCard().allergies.length).toBeLessThanOrEqual(300);
    store.set("bm_medcard", "{broken");
    expect(isEmptyCard(loadCard())).toBe(true);
  });
  it("адрес сервера: https по умолчанию, http только для локальной сети", () => {
    expect(normalizeServer("bepulmed-ai.foo.workers.dev/")).toBe("https://bepulmed-ai.foo.workers.dev");
    expect(normalizeServer("http://10.0.2.2:8787")).toBe("http://10.0.2.2:8787");
    expect(normalizeServer("http://evil.com")).toBeNull();
    expect(normalizeServer("  ")).toBeNull();
  });
});
