import { describe, expect, it } from "vitest";
import { FREE_MEDS } from "../data/freeMeds";
import { DISTRICTS, nearestDistrict, TASHKENT_FACILITIES } from "../data/tashkentFacilities";
import { searchMeds } from "../components/Medicines";
import { searchFacilities } from "./facilitySearch";
import { editDistance, norm, tokenMatch, tokens } from "./search";
import { routeVoice } from "./voiceRouter";

const medNames = (q: string, n = 8) => searchMeds(q).slice(0, n).map((h) => h.item.ru);
const facNames = (q: string, n = 5) => searchFacilities(q).slice(0, n).map((h) => h.item.ru);

describe("данные", () => {
  it("перечень лекарств: 69 позиций с номерами 1…69 по приказу, без дублей", () => {
    expect(FREE_MEDS).toHaveLength(69);
    expect(FREE_MEDS.map((m) => m.n)).toEqual(Array.from({ length: 69 }, (_, i) => i + 1));
  });
  it("справочник Ташкента: у всех есть название RU/UZ и адрес, id уникальны", () => {
    expect(TASHKENT_FACILITIES.length).toBeGreaterThan(100);
    expect(new Set(TASHKENT_FACILITIES.map((f) => f.id)).size).toBe(TASHKENT_FACILITIES.length);
    for (const f of TASHKENT_FACILITIES) {
      expect(f.ru.length).toBeGreaterThan(3);
      expect(f.uz.length).toBeGreaterThan(3);
      expect(f.address.length).toBeGreaterThan(3);
    }
    // В каждом районе города есть хотя бы одно учреждение
    for (const d of Object.keys(DISTRICTS).filter((k) => k !== "region")) expect(TASHKENT_FACILITIES.some((f) => f.district === d)).toBe(true);
  });
});

describe("нечёткий поиск", () => {
  it("нормализация кириллицы/латиницы и апострофов", () => {
    expect(norm("Qon bosimi")).toBe("qon bosimi");
    expect(norm("O‘pka")).toBe(norm("o'pka"));
    expect(norm("Давление")).toBe("davlenie");
    expect(tokens("бесплатные лекарства от давления")).toEqual(["davleniya"]);
  });
  it("окончания и опечатки", () => {
    expect(tokenMatch("davleniya", "davlenie")).toBeGreaterThan(0.7);
    expect(tokenMatch(norm("бисапролол"), norm("бисопролол"))).toBeGreaterThan(0);
    expect(editDistance("abcd", "abdc")).toBe(1);
    expect(tokenMatch("kot", "kardiolog")).toBe(0);
  });
});

describe("поиск бесплатных лекарств", () => {
  it("«от давления» → препараты от давления", () => {
    const r = medNames("бесплатные лекарства от давления");
    expect(r).toEqual(expect.arrayContaining(["Амлодипин", "Эналаприл", "Бисопролол"]));
  });
  it("по-узбекски «qand uchun» → диабет", () => {
    expect(medNames("qand uchun dori")).toEqual(expect.arrayContaining(["Метформин", "Гликлазид"]));
    expect(medNames("qand uchun dori", 3)).not.toContain("Десмопрессин");
  });
  it("по торговому названию и с опечаткой", () => {
    expect(medNames("конкор", 1)).toEqual(["Бисопролол"]);
    expect(medNames("бисапролол", 1)).toEqual(["Бисопролол"]);
    expect(medNames("omez", 1)).toEqual(["Омепразол"]);
    expect(medNames("глюкофаж", 1)).toEqual(["Метформин"]);
  });
  it("по симптому", () => {
    expect(medNames("глисты", 1)).toEqual(["Альбендазол"]);
    expect(medNames("изжога")[0]).toBe("Омепразол");
    expect(medNames("малокровие")).toEqual(expect.arrayContaining(["Соединения железа (II)", "Соединения железа (III)"]));
    expect(medNames("холестерин", 1)).toEqual(["Аторвастатин"]);
  });
  it("нет в перечне → пусто", () => {
    expect(medNames("виагра")).toEqual([]);
  });
});

describe("поиск по клиникам Ташкента", () => {
  it("по специальности", () => {
    expect(facNames("кардиология", 1)[0]).toMatch(/кардиологии/);
    expect(facNames("ko'z", 2).join(" ")).toMatch(/офтальмолог|глаза/);
    expect(facNames("диабет", 1)[0]).toMatch(/эндокринологии/);
  });
  it("по номеру поликлиники и району", () => {
    expect(facNames("поликлиника 36", 1)).toEqual(["Семейная поликлиника №36"]);
    expect(searchFacilities("Чиланзар").length).toBeGreaterThan(5);
    expect(searchFacilities("Chilonzor").length).toBe(searchFacilities("Чиланзар").length);
    const chil = searchFacilities("поликлиника в Чиланзаре");
    expect(chil.length).toBeGreaterThan(5);
    expect(chil.length).toBeLessThan(20);
  });
  it("район по GPS", () => {
    expect(nearestDistrict({ lat: 41.276, lon: 69.203 })).toBe("chilonzor");
    expect(nearestDistrict({ lat: 41.366, lon: 69.29 })).toBe("yunusobod");
    expect(nearestDistrict({ lat: 39.65, lon: 66.96 })).toBeNull(); // Самарканд
  });
});

describe("голосовые команды", () => {
  it("экстренное — раньше всего", () => {
    expect(routeVoice("у меня сильная боль в груди")).toEqual({ kind: "firstaid", id: "heart_attack", urgent: true });
  });
  it("лекарства, клиники, аптеки, запись", () => {
    expect(routeVoice("бесплатные лекарства от давления")).toEqual({ kind: "meds", query: "бесплатные лекарства от давления" });
    expect(routeVoice("bosim uchun bepul dorilar").kind).toBe("meds");
    expect(routeVoice("где кардиологический центр").kind).toBe("facility");
    expect(routeVoice("Chilonzordagi poliklinika").kind).toBe("facility");
    expect(routeVoice("найди аптеку рядом").kind).toBe("pharmacy");
    expect(routeVoice("хочу записаться к терапевту").kind).toBe("book");
    expect(routeVoice("мои талоны").kind).toBe("tickets");
    expect(routeVoice("как получить направление").kind).toBe("chat");
    expect(routeVoice("как получить направление к кардиологу").kind).toBe("chat");
    expect(routeVoice("где принимает кардиолог").kind).toBe("facility");
  });
});
