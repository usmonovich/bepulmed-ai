import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.resetModules();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  vi.stubGlobal("navigator", { onLine: true, userAgent: "test" });
});

const NEURO = { id: "d1", name: "Юсупова М. А.", specialty: "neurology", room: "214", week: [[], [[480, 780]], [], [[840, 1080]], [], [], []], source: "bepulmed" };

describe("врачи поликлиники", () => {
  it("с сервера BepulMed → показываем и сохраняем; без интернета — из сохранённого", async () => {
    const { loadDoctors } = await import("./doctorsDirectory");
    const f = vi.fn(async (url: string) => {
      expect(url).toContain("/api/directory/doctors?facility=fp35");
      return new Response(JSON.stringify({ doctors: [NEURO], source: "bepulmed", checkedAt: "2026-11-17T09:00:00Z" }), { status: 200 });
    });
    const a = await loadDoctors("fp35", "СП №35", f as unknown as typeof fetch, 1000);
    expect(a.doctors[0].name).toBe("Юсупова М. А.");
    expect(a.source).toBe("bepulmed");
    vi.stubGlobal("navigator", { onLine: false, userAgent: "test" });
    const off = vi.fn();
    const b = await loadDoctors("fp35", "СП №35", off as unknown as typeof fetch);
    expect(off).not.toHaveBeenCalled();
    expect(b).toMatchObject({ offline: true, savedAt: 1000, source: "bepulmed" });
    expect(b.doctors[0].week![1]).toEqual([[480, 780]]);
  });
  it("не опубликовано и DMED не подключён → пусто, без ошибок", async () => {
    const { loadDoctors } = await import("./doctorsDirectory");
    const f = vi.fn(async () => new Response(JSON.stringify({ doctors: [], source: null }), { status: 200 }));
    expect(await loadDoctors("x", "X", f as unknown as typeof fetch)).toMatchObject({ doctors: [], source: null });
  });
  it("сервер недоступен → не падаем", async () => {
    const { loadDoctors } = await import("./doctorsDirectory");
    const f = vi.fn(async () => {
      throw new Error("down");
    });
    expect((await loadDoctors("x", "X", f as unknown as typeof fetch)).doctors).toEqual([]);
  });
});
