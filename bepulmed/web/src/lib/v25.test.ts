import { describe, expect, it } from "vitest";
import { FIRST_AID } from "../data/firstAid";
import { TASHKENT_FACILITIES } from "../data/tashkentFacilities";
import { searchAid } from "../components/FirstAid";
import { nearestFacilities } from "./facilitySearch";
import { dropSuspicious, matchOsm, plausible, polyNumber } from "./coords";
import { routeVoice } from "./voiceRouter";

const aid = (q: string) => searchAid(q)[0]?.item.id;

describe("первая помощь: данные", () => {
  it("у каждой инструкции есть RU и UZ, шаги, когда звонить; id уникальны", () => {
    expect(FIRST_AID.length).toBeGreaterThanOrEqual(30);
    expect(new Set(FIRST_AID.map((g) => g.id)).size).toBe(FIRST_AID.length);
    for (const g of FIRST_AID) {
      for (const l of ["ru", "uz"] as const) {
        expect(g[l].title.length).toBeGreaterThan(5);
        expect(g[l].steps.length).toBeGreaterThanOrEqual(3);
        expect(g[l].call).toMatch(/103|112|104|101/);
      }
      expect(g.ru.steps.length).toBe(g.uz.steps.length); // перевод не потерял шаги
    }
  });
  it("реанимация — по рекомендациям ERC: 5–6 см, 100–120 в минуту, 30:2", () => {
    const cpr = FIRST_AID.find((g) => g.id === "cpr")!;
    const t = cpr.ru.steps.join(" ");
    expect(t).toMatch(/5–6 см/);
    expect(t).toMatch(/100–120/);
    expect(t).toMatch(/30 нажатий.*2 вдоха/);
  });
});

describe("первая помощь: поиск по описанию (RU/UZ)", () => {
  it.each([
    ["обжёгся кипятком", "burn"],
    ["порезался, течёт кровь", "bleeding"],
    ["не дышит", "cpr"],
    ["подавился костью", "choking"],
    ["перекосило лицо", "stroke"],
    ["укусил скорпион", "snake"],
    ["кровь из носа", "nosebleed"],
    ["угорели от печки", "co"],
    ["сломал руку", "fracture"],
    ["ударило током", "electric"],
    ["qaynoq suvdan kuydi", "burn"],
    ["ilon chaqdi", "snake"],
    ["bolada isitma", "fever_child"],
    ["it tishladi", "animal_bite"],
  ])("«%s» → %s", (q, id) => {
    expect(aid(q)).toBe(id);
  });
});

describe("помощник: доступ ко всем функциям", () => {
  it.each([
    ["у меня сильная боль в груди", "firstaid"],
    ["вызови скорую", "call"],
    ["позвони 103", "call"],
    ["ближайшая поликлиника", "facility"],
    ["покажи мою медкарту", "medcard"],
    ["отсканируй рецепт", "scanner"],
    ["отправь близким где я", "sos"],
    ["говори по-узбекски", "lang"],
    ["что ты умеешь", "help"],
    ["бесплатные лекарства от давления", "meds"],
    ["мои талоны", "tickets"],
    ["хочу записаться к терапевту", "book"],
    ["найди аптеку", "pharmacy"],
    ["голова болит", "chat"],
  ])("«%s» → %s", (q, kind) => {
    expect(routeVoice(q).kind).toBe(kind);
  });
  it("ребёнок vs младенец", () => {
    expect(routeVoice("ребёнок подавился")).toMatchObject({ id: "choking" });
    expect(routeVoice("грудничок подавился")).toMatchObject({ id: "choking_infant" });
  });
});

describe("координаты учреждений", () => {
  const p36 = TASHKENT_FACILITIES.find((f) => f.ru === "Семейная поликлиника №36")!;
  const cardio = TASHKENT_FACILITIES.find((f) => /кардиологии/.test(f.ru))!;
  it("номер поликлиники", () => {
    expect(polyNumber("Семейная поликлиника №36")).toBe("36");
    expect(polyNumber("36-sonli oilaviy poliklinika")).toBe("36");
    expect(polyNumber("Oilaviy poliklinika № 7")).toBe("7");
  });
  it("правдоподобность: в Ташкенте и рядом со своим районом", () => {
    expect(plausible(p36, { lat: 41.285, lon: 69.21 })).toBe(true); // Чиланзар
    expect(plausible(p36, { lat: 41.36, lon: 69.33 })).toBe(false); // другой конец города
    expect(plausible(p36, { lat: 39.65, lon: 66.96 })).toBe(false); // Самарканд
  });
  it("геокодер: «центр города» и одна точка на много адресов отбрасываются", () => {
    expect(plausible(cardio, { lat: 41.2996, lon: 69.2402 }, "geocoder")).toBe(false);
    const c = dropSuspicious({
      a: { lat: 41.3, lon: 69.25, src: "geocoder" },
      b: { lat: 41.3001, lon: 69.2501, src: "geocoder" },
      d: { lat: 41.3002, lon: 69.2502, src: "geocoder" },
      e: { lat: 41.31, lon: 69.26, src: "geocoder" },
      f: { lat: 41.3, lon: 69.25, src: "osm" },
    });
    expect(Object.keys(c).sort()).toEqual(["e", "f"]);
  });
  it("сопоставление с OSM: по номеру и району, без ложных совпадений", () => {
    const osm = [
      { type: "node", id: 1, lat: 41.2855, lon: 69.2121, tags: { amenity: "clinic", name: "36-sonli oilaviy poliklinika" } },
      { type: "node", id: 2, lat: 41.37, lon: 69.29, tags: { amenity: "clinic", name: "Oilaviy poliklinika 36" } }, // Юнусабад — слишком далеко
      { type: "node", id: 3, lat: 41.326, lon: 69.334, tags: { amenity: "hospital", name: "Республиканский специализированный центр кардиологии" } },
      { type: "node", id: 4, lat: 41.33, lon: 69.33, tags: { amenity: "hospital", name: "Городская больница №1" } },
    ];
    const m = matchOsm(osm as any);
    expect(m[p36.id]).toMatchObject({ lat: 41.2855, lon: 69.2121, src: "osm" });
    expect(m[p36.id].osm).toMatch(/^(node|way|relation)\//);
    expect(m[cardio.id]).toMatchObject({ lat: 41.326, src: "osm" });
    expect(Object.values(m).some((c) => c.lat === 41.33)).toBe(false); // «Городская больница №1» ни с чем не сопоставлена
  });
  it("ближайшие по расстоянию и с фильтром запроса", () => {
    const coords = { [p36.id]: { lat: 41.2855, lon: 69.2121, src: "osm" as const }, [cardio.id]: { lat: 41.326, lon: 69.334, src: "osm" as const } };
    const here = { lat: 41.284, lon: 69.21 };
    expect(nearestFacilities(here, "", coords)[0].item.id).toBe(p36.id);
    expect(nearestFacilities(here, "ближайшая кардиология", coords)[0].item.id).toBe(cardio.id);
    expect(nearestFacilities(here, "", coords)[0].km).toBeLessThan(1);
  });
});

import { describe as d27, expect as e27, it as i27 } from "vitest";
import { routeVoice as rv27 } from "./voiceRouter";
import { loadTickets, saveTickets } from "./ticketCache";

d27("2.7 офлайн", () => {
  i27("голос: «что работает без интернета» → экран офлайн-готовности", () => {
    e27(rv27("что работает без интернета").kind).toBe("offline");
    e27(rv27("oflayn rejim").kind).toBe("offline");
    // но «аптека … без интернета» — всё равно аптека, а «ожог» — первая помощь
    e27(rv27("найди аптеку без интернета").kind).not.toBe("offline");
    e27(rv27("что делать при ожоге").kind).toBe("firstaid");
  });
  i27("талоны сохраняются для офлайна", () => {
    const store: Record<string, string> = {};
    (globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v), removeItem: (k: string) => delete store[k] };
    saveTickets([{ id: "a1", ticket: "A-12" } as any], [], 1000);
    const s = loadTickets();
    e27(s?.appointments[0].ticket).toBe("A-12");
    e27(s?.at).toBe(1000);
  });
});
