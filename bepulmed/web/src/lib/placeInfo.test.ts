import { describe, expect, it, vi } from "vitest";
import { bestMatch, districtOf, facilityStatus, kindOfFacility, lookupPlaces, ownership } from "./placeInfo";
import { routeVoice } from "./voiceRouter";

const F = (name: string, extra: object = {}) => ({ name, kind: "clinic" as const, source: "osm" as const, ...extra });

describe("онлайн-справка на телефоне", () => {
  it("платно / бесплатно", () => {
    expect(ownership(F("Семейная поликлиника №35"))).toBe("free");
    expect(ownership(F("35-sonli oilaviy poliklinika"))).toBe("free");
    expect(ownership(F("Городская клиническая больница №1"))).toBe("free");
    expect(ownership(F("Shams Medical Center"))).toBe("paid");
    expect(ownership(F("Стоматология Dental Pro"))).toBe("paid");
    expect(ownership(F("Поликлиника", { operatorType: "private" }))).toBe("paid");
    expect(ownership(F("Akfa Medline", { operatorType: "public" }))).toBe("free");
    expect(ownership({ name: "Grand Pharm", kind: "pharmacy", source: "osm" })).toBe("paid");
    expect(ownership(F("Центр здоровья"))).toBe("unknown");
  });
  it("«открыто сейчас» из OSM", () => {
    const now = Date.parse("2026-11-18T10:00:00+05:00");
    expect(facilityStatus({ openingHours: "Mo-Fr 08:00-18:00" }, now)).toMatchObject({ open: true, until: "18:00" });
    expect(facilityStatus({ openingHours: undefined }, now)).toBeNull();
  });
  it("район — по точке учреждения; за пределами города — без района", () => {
    expect(districtOf({ lat: 41.277, lon: 69.205 })).toBe("chilonzor");
    expect(districtOf({ lat: 40.1, lon: 65.3 })).toBeUndefined();
  });
  it("тип для поиска", () => {
    expect(kindOfFacility({ kind: "clinic", name: "Стоматология Smile" })).toBe("dentist");
    expect(kindOfFacility({ kind: "clinic", name: "Лаборатория Intermed" })).toBe("lab");
  });
  it("в запрос уходят только kind, q, district — без координат, языка, идентификаторов", async () => {
    const f = vi.fn(async (_url: string) => new Response(JSON.stringify({ places: [], fetchedAt: "x" }), { status: 200 }));
    const r = await lookupPlaces({ kind: "pharmacy", q: "Grand Pharm", district: "chilonzor" }, f as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    const u = new URL(f.mock.calls[0][0], "https://x");
    expect([...u.searchParams.keys()].sort()).toEqual(["district", "kind", "q"]);
    expect(u.pathname).toBe("/api/lookup");
  });
  it("личный запрос не отправляется вообще", async () => {
    const f = vi.fn();
    expect(await lookupPlaces({ kind: "clinic", q: "у меня болит зуб" }, f as unknown as typeof fetch)).toEqual({ ok: false, error: "personal" });
    expect(f).not.toHaveBeenCalled();
  });
  it("сервер без ключа 2GIS → понятная ошибка", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 503 }));
    expect((await lookupPlaces({ kind: "pharmacy", q: "аптека" }, f as unknown as typeof fetch)).ok).toBe(false);
  });
  it("совпадение названий", () => {
    const ps = [{ name: "Grand Pharm, сеть аптек" }, { name: "Oxy Med" }] as never[];
    expect(bestMatch("Grand Pharm", ps)).toBe(ps[0]);
    expect(bestMatch("Совсем другое", ps)).toBeUndefined();
  });
  it("голос: «открытые аптеки» → фильтр «открыто сейчас»", () => {
    expect(routeVoice("какие аптеки сейчас открыты")).toEqual({ kind: "pharmacy", openNow: true });
    expect(routeVoice("круглосуточная аптека")).toEqual({ kind: "pharmacy", openNow: true });
    expect(routeVoice("hozir ochiq dorixona")).toEqual({ kind: "pharmacy", openNow: true });
    expect(routeVoice("аптека рядом")).toEqual({ kind: "pharmacy", openNow: false });
  });
});
