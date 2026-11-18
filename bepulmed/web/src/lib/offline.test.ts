import { beforeEach, describe, expect, it } from "vitest";
import { compact, facilitiesNearLocal, inTashkent, localChat, overpass, OVERPASS_ENDPOINTS, tashkentData, tashkentQuery } from "./offline";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
});

// Мини-ответ Overpass: больница и аптека в центре Ташкента, поликлиника на Чиланзаре, объект без названия.
const ELEMENTS = [
  { type: "node", id: 1, lat: 41.3115, lon: 69.2797, tags: { amenity: "hospital", name: "Больница A", "name:uz": "Shifoxona A", phone: "+998 71 000-00-01", extra: "x" } },
  { type: "way", id: 2, center: { lat: 41.312, lon: 69.281 }, tags: { amenity: "pharmacy", name: "Аптека B", opening_hours: "24/7" } },
  { type: "node", id: 3, lat: 41.285, lon: 69.204, tags: { amenity: "clinic", name: "Поликлиника C" } },
  { type: "node", id: 4, lat: 41.3, lon: 69.25, tags: { amenity: "pharmacy" } },
];
function fakeFetch(calls: string[], fail = 0) {
  return (async (url: string) => {
    calls.push(String(url));
    if (calls.length <= fail) throw new Error("down");
    return new Response(JSON.stringify({ elements: ELEMENTS }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("чат без сервера", () => {
  it("экстренные признаки → 103/112 раньше всего остального", () => {
    const r = localChat([{ role: "user", text: "сильная боль в груди и трудно дышать" }], "ru");
    expect(r.emergency).toBe(true);
    expect(r.answer).toMatch(/103/);
  });
  it("обычный вопрос → ответ из базы официальных источников", () => {
    const r = localChat([{ role: "user", text: "Куда идти за направлением?" }], "ru");
    expect(r.emergency).toBe(false);
    expect(r.mode).toBe("offline");
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.answer.length).toBeGreaterThan(40);
  });
  it("по-узбекски", () => {
    expect(localChat([{ role: "user", text: "Bepul dori qanday olaman?" }], "uz").answer).not.toMatch(/[А-Яа-я]{6,}/);
  });
});

describe("учреждения Ташкента без сервера", () => {
  it("границы города и запрос Overpass", () => {
    expect(inTashkent({ lat: 41.311, lon: 69.279 })).toBe(true);
    expect(inTashkent({ lat: 39.65, lon: 66.96 })).toBe(false); // Самарканд
    expect(tashkentQuery()).toContain("(41.17,69.12,41.43,69.45)");
    expect(tashkentQuery()).toContain('"amenity"~"^(hospital|clinic|doctors|pharmacy)$"');
  });
  it("компактный кэш: только нужные теги, без безымянных", () => {
    const c = compact(ELEMENTS as any);
    expect(c).toHaveLength(3);
    expect(c[0].tags).not.toHaveProperty("extra");
    expect(c[1]).toMatchObject({ lat: 41.312, lon: 69.281 });
  });
  it("зеркала Overpass перебираются по очереди", async () => {
    const calls: string[] = [];
    await overpass("q", fakeFetch(calls, 2));
    expect(calls.map((u) => u.split("?")[0])).toEqual(OVERPASS_ENDPOINTS);
  });
  it("первый раз скачивает город, потом работает из кэша без сети", async () => {
    const calls: string[] = [];
    const a = await facilitiesNearLocal({ lat: 41.3111, lon: 69.2797 }, 1000, "ru", fakeFetch(calls));
    expect(a.from).toBe("tashkent_cache");
    expect(a.facilities.map((f) => f.name)).toEqual(["Больница A", "Аптека B"]); // Чиланзар дальше 1 км
    const offline = (async () => {
      throw new Error("нет интернета");
    }) as unknown as typeof fetch;
    const b = await facilitiesNearLocal({ lat: 41.3111, lon: 69.2797 }, 10000, "uz", offline);
    expect(b.facilities.map((f) => f.name)).toEqual(["Shifoxona A", "Аптека B", "Поликлиника C"]);
    expect(calls.filter((c) => !c.includes("/data/"))).toHaveLength(1); // в сеть — один раз; /data/ — встроенный снимок
  });
  it("кэш старше 30 дней обновляется, а без сети остаётся старый", async () => {
    await tashkentData(fakeFetch([]));
    const later = Date.now() + 31 * 24 * 3600 * 1000;
    const offline = (async () => {
      throw new Error("нет сети");
    }) as unknown as typeof fetch;
    const c = await tashkentData(offline, later);
    expect(c.elements).toHaveLength(3);
  });
  it("вне Ташкента — запрос рядом прямо с устройства", async () => {
    const calls: string[] = [];
    // Точные координаты пользователя (39.6543, 66.9612) не уходят: округление до 0,01° и радиус +1 км.
    const r = await facilitiesNearLocal({ lat: 39.6543, lon: 66.9612 }, 3000, "ru", fakeFetch(calls));
    expect(r.from).toBe("overpass_live");
    expect(decodeURIComponent(calls[0])).toContain("around:4000,39.650000,66.960000");
    expect(decodeURIComponent(calls[0])).not.toContain("39.6543");
  });
});
