import { describe, expect, it } from "vitest";
import { analyzeText, icdChapter, parseLabText, parseMedicalDoc, parsePrescription } from "./labs";

const CBC = `Общий анализ крови  12.11.2026
Гемоглобин (HGB) 98 г/л 120-160 L
Лейкоциты 12,4 х10^9/л 4,0-9,0
Эритроциты 4,1 10^12/л 3,7-4,7
Тромбоциты 250 150-400
СОЭ 12 мм/ч до 15`;

describe("parseLabText", () => {
  it("берёт норму с бланка и ставит флаги", () => {
    const r = parseLabText(CBC);
    const by = Object.fromEntries(r.map((x) => [x.analyte.id, x]));
    expect(by.hgb.value).toBe(98);
    expect(by.hgb.range).toMatchObject({ low: 120, high: 160, from: "document" });
    expect(by.hgb.status).toBe("low");
    expect(by.wbc.value).toBe(12.4);
    expect(by.wbc.range).toMatchObject({ low: 4, high: 9 });
    expect(by.wbc.status).toBe("high");
    expect(by.rbc.status).toBe("normal");
    expect(by.plt.status).toBe("normal");
    expect(by.esr.range).toMatchObject({ low: null, high: 15 });
    expect(by.esr.status).toBe("normal");
  });

  it("без нормы на бланке — встроенный ориентир", () => {
    const [g] = parseLabText("Глюкоза 7,8 ммоль/л");
    expect(g.range?.from).toBe("builtin");
    expect(g.status).toBe("high");
  });

  it("пересчитывает единицы и находит критические значения", () => {
    const [g] = parseLabText("Glucose 45 mg/dL");
    expect(g.canonical).toBeCloseTo(2.5, 1);
    expect(g.status).toBe("critical-low");
    const [k] = parseLabText("Калий 6,8 ммоль/л 3,5-5,1");
    expect(k.status).toBe("critical-high");
    const [h] = parseLabText("Hemoglobin 6.5 g/dL");
    expect(h.canonical).toBe(65);
    expect(h.status).toBe("critical-low");
  });

  it("понимает узбекские названия и «<»", () => {
    const r = parseLabText("Gemoglobin 135 g/l\nXolesterin 6,1 mmol/l < 5,2");
    expect(r.map((x) => x.analyte.id)).toEqual(["hgb", "chol"]);
    expect(r[1].status).toBe("high");
  });

  it("не путает «аст» внутри слов и не берёт строки без чисел", () => {
    expect(parseLabText("Пластырь наложен\nКонтрастная жидкость")).toEqual([]);
    expect(parseLabText("Гемоглобин — в норме")).toEqual([]);
  });
});

describe("рецепт и выписка", () => {
  it("находит лекарства и помечает бесплатные", () => {
    const rx = parsePrescription("Рецепт: Бисопролол 5 мг 1 таб утром\nМетформин 1000 мг 2 раза в день\nВитамин С 500 мг по 1 таб");
    expect(rx.map((x) => x.name.toLowerCase())).toEqual(expect.arrayContaining(["бисопролол", "метформин"]));
    expect(rx.find((x) => /метформин/i.test(x.name))?.free).toBeTruthy();
    expect(rx.find((x) => /витамин/i.test(x.name))?.free).toBeUndefined();
  });

  it("диагноз, МКБ-10 и рекомендации из выписки", () => {
    const d = parseMedicalDoc(`ВЫПИСКА ИЗ ИСТОРИИ БОЛЕЗНИ
Диагноз: Гипертоническая болезнь II ст. (I11.9). Сахарный диабет 2 типа E11
Рекомендовано:
- контроль АД 2 раза в день
- наблюдение у эндокринолога
Дата выписки 15.11.2026`);
    expect(d.diagnosis[0]).toMatch(/Гипертоническая/);
    expect(d.icd.map((x) => x.code)).toEqual(["I11.9", "E11"]);
    expect(d.icd[0].chapter.ru).toMatch(/кровообращения/);
    expect(d.recommendations).toContain("контроль АД 2 раза в день");
    expect(d.dates).toContain("15.11.2026");
    expect(icdChapter("Z00")?.ru).toMatch(/Факторы/);
  });

  it("analyzeText: вид документа и срочность", () => {
    expect(analyzeText(CBC).kind).toBe("lab");
    expect(analyzeText(CBC).abnormal).toBe(2);
    expect(analyzeText("Калий 2,1 ммоль/л").urgent).toBe(true);
    expect(analyzeText("Эпикриз. Диагноз: ОРВИ J06.9").kind).toBe("discharge");
    const d = analyzeText("ВЫПИСКА\nДиагноз: Сахарный диабет 2 типа (E11.9)\nHbA1c 7,2 % 4,0-6,0\nХолестерин общий 6,4 ммоль/л < 5,2");
    expect(d.kind).toBe("discharge");
    expect(d.doc.diagnosis).toEqual(["Сахарный диабет 2 типа (E11.9)"]);
    expect(d.labs.map((x) => x.status)).toEqual(["high", "high"]);
  });
});
