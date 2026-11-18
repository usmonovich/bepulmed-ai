import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.resetModules();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
});

const BUNDLE = { fetchedAt: "2026-11-10T00:00:00Z", elements: [{ type: "node", id: 9, lat: 41.28, lon: 69.2, tags: { amenity: "pharmacy", name: "Встроенная аптека", opening_hours: "24/7" } }] };

describe("встроенный снимок Ташкента", () => {
  it("первый запуск без интернета: берётся снимок из приложения, сеть не нужна", async () => {
    const { facilitiesNearLocal } = await import("./offline");
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url);
      if (url.includes("/data/tashkent_osm.json")) return new Response(JSON.stringify(BUNDLE), { status: 200 });
      throw new Error("нет интернета");
    }) as unknown as typeof fetch;
    const r = await facilitiesNearLocal({ lat: 41.2801, lon: 69.2001 }, 1000, "ru", f, );
    expect(r.facilities.map((x) => x.name)).toEqual(["Встроенная аптека"]);
    expect(calls.every((c) => c.includes("/data/"))).toBe(true);
  });
  it("свежие данные телефона не затираются старым снимком", async () => {
    store.set("bm_osm_tashkent_v1", JSON.stringify({ fetchedAt: "2026-11-17T00:00:00Z", elements: [] }));
    const { primeFromBundle } = await import("./offline");
    const c = await primeFromBundle((async () => new Response(JSON.stringify(BUNDLE))) as unknown as typeof fetch);
    expect(c?.fetchedAt).toBe("2026-11-17T00:00:00Z");
  });
});

describe("автообновление", () => {
  it("без интернета — ничего не делает", async () => {
    const { syncNow } = await import("./sync");
    expect(await syncNow({ online: false })).toEqual({ updated: false, skipped: "offline" });
  });
  it("с интернетом — обновляет устаревшие данные и сообщает", async () => {
    const { syncNow, syncState } = await import("./sync");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    const refresh = vi.fn(async () => {
      const c = { fetchedAt: new Date().toISOString(), elements: BUNDLE.elements as never[] };
      store.set("bm_osm_tashkent_v1", JSON.stringify(c));
      return c;
    });
    const r = await syncNow({ online: true, refresh });
    expect(refresh).toHaveBeenCalledOnce();
    expect(r.updated).toBe(true);
    expect(syncState().lastOk).toBeTypeOf("number");
    // повторно сразу — не дёргаем сеть
    expect((await syncNow({ online: true, refresh })).skipped).toBe("recent");
    vi.unstubAllGlobals();
  });
  it("свежие данные (младше 3 дней) не перекачиваются", async () => {
    store.set("bm_osm_tashkent_v1", JSON.stringify({ fetchedAt: new Date().toISOString(), elements: [] }));
    const { syncNow } = await import("./sync");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    const refresh = vi.fn();
    await syncNow({ online: true, refresh: refresh as never });
    expect(refresh).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
