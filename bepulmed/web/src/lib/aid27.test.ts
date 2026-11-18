import { describe, expect, it } from "vitest";
import { routeVoice, suggestAid } from "./voiceRouter";
import { FIRST_AID } from "../data/firstAid";

const kindId = (q: string) => {
  const r = routeVoice(q) as { kind: string; id?: string };
  return r.id ? `${r.kind}:${r.id}` : r.kind;
};

describe("2.7 первая помощь: маршрутизация без опасных подмен", () => {
  it.each([
    ["что делать при ожоге", "firstaid:burn"],
    ["сильное кровотечение из ноги", "firstaid:bleeding"],
    ["кровь из носа", "firstaid:nosebleed"],
    ["что делать при ушибе", "firstaid:wound"],
    ["порезал палец ножом", "firstaid:wound"],
    ["укусил клещ", "firstaid:insect"],
    ["ari chaqdi", "firstaid:insect"],
    ["попало в глаз", "firstaid:eye"],
    ["не хочу жить", "firstaid:crisis"],
    ["что работает без интернета", "offline"],
  ])("%s → %s", (q, want) => expect(kindId(q)).toBe(want));

  it("«ушиб» не путается с узбекским «tushib» (гипогликемия)", () => {
    expect(suggestAid("ушиб ноги")?.id).toBe("wound");
  });
  it("подсказка «похоже на…» не появляется для общих жалоб", () => {
    for (const q of ["болит зуб", "у меня болит голова", "болит горло", "сахар 15", "температура 38", "что делать с документами"]) expect(suggestAid(q)).toBeNull();
  });
  it("слабое совпадение — только подсказка, не автопереход", () => {
    expect(kindId("утонул в бассейне")).toBe("chat");
    expect(suggestAid("утонул в бассейне")?.id).toBe("drowning");
  });
  it("34 инструкции, у каждой есть RU и UZ тексты и «когда звонить»", () => {
    expect(FIRST_AID.length).toBe(34);
    for (const g of FIRST_AID) {
      expect(g.ru.steps.length).toBeGreaterThan(0);
      expect(g.uz.steps.length).toBe(g.ru.steps.length);
      expect(g.ru.call && g.uz.call).toBeTruthy();
    }
  });
});

describe("2.8 голос → DMED", () => {
  it.each(["открой DMED", "мои рецепты", "электронные рецепты", "elektron retseptlarim", "дмед"])("%s → dmed", (q) => expect(kindId(q)).toBe("dmed"));
  it.each([["бесплатный инсулин", "meds"], ["ближайшая поликлиника", "facility"]])("%s → %s (не DMED)", (q, k) => expect(kindId(q)).toBe(k));
});
