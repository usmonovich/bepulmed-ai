// Разбор медицинских документов на телефоне (без интернета): анализы, рецепты, выписки.
// Не ставит диагнозов. Норма — ПРЕЖДЕ ВСЕГО с бланка лаборатории (у лабораторий она различается);
// встроенный диапазон — только ориентир для взрослых, если на бланке нормы нет.
// Критические значения — по спискам критических значений лабораторий (UChicago, Mayo Clinic Labs,
// Hunterdon MC); пороги глюкозы/HbA1c — критерии ADA (диабет: глюкоза натощак ≥7,0 ммоль/л, HbA1c ≥6,5%).
import { FREE_MEDS, type FreeMed } from "../data/freeMeds";
import { search } from "./search";

export type Unit = string; // каноническая единица анализа
interface Analyte {
  id: string;
  ru: string;
  uz: string;
  /** Как пишут на бланках: RU/UZ/EN и аббревиатуры анализаторов. В нижнем регистре. */
  aliases: string[];
  unit: Unit;
  /** Пересчёт других единиц в каноническую: множитель. */
  conv?: Record<string, number>;
  /** Если единица не распознана: диапазон «правдоподобных» значений канонической единицы. */
  plausible?: [number, number];
  /** Ориентир для взрослых (если на бланке нормы нет). */
  ref?: [number | null, number | null];
  /** Критично: срочно к врачу / 103. */
  critical?: [number | null, number | null];
  low?: { ru: string; uz: string };
  high?: { ru: string; uz: string };
  doctor?: "family" | "endocrinology" | "cardiology" | "nephrology" | "gastro" | "hematology";
  group: "blood" | "biochem" | "sugar" | "lipids" | "thyroid" | "urine" | "inflammation" | "coag";
}

const FD = { ru: "Обсудите с семейным врачом.", uz: "Oilaviy shifokor bilan muhokama qiling." };
const why = (ru: string, uz: string) => ({ ru: `${ru} ${FD.ru}`, uz: `${uz} ${FD.uz}` });

export const ANALYTES: Analyte[] = [
  // ---- Общий анализ крови
  { id: "hgb", ru: "Гемоглобин", uz: "Gemoglobin", aliases: ["гемоглобин", "hgb", "hb", "gemoglobin", "hemoglobin"], unit: "г/л", conv: { "г/дл": 10, "g/dl": 10, "g/l": 1, "г/л": 1 }, plausible: [30, 250], ref: [120, 175], critical: [70, 200], low: why("Ниже нормы бывает при анемии (например, из-за нехватки железа) или кровопотере.", "Kamqonlik (masalan, temir yetishmasligi) yoki qon yo‘qotishda pasayadi."), high: why("Выше нормы бывает при обезвоживании, курении.", "Suvsizlanish, chekishda oshadi."), doctor: "family", group: "blood" },
  { id: "wbc", ru: "Лейкоциты", uz: "Leykotsitlar", aliases: ["лейкоциты", "wbc", "leykotsit", "leykotsitlar", "leukocytes", "лейкоц"], unit: "×10⁹/л", plausible: [0.1, 200], ref: [4.0, 11.0], critical: [1.0, 100], low: why("Ниже нормы бывает после вирусных инфекций, на фоне некоторых лекарств.", "Virusli infeksiyalardan keyin, ayrim dorilarda pasayadi."), high: why("Выше нормы чаще всего бывает при воспалении или инфекции.", "Ko‘pincha yallig‘lanish yoki infeksiyada oshadi."), doctor: "family", group: "blood" },
  { id: "rbc", ru: "Эритроциты", uz: "Eritrotsitlar", aliases: ["эритроциты", "rbc", "eritrotsit", "eritrotsitlar", "erythrocytes"], unit: "×10¹²/л", plausible: [1, 9], ref: [3.5, 6.2], low: why("Ниже нормы — часто вместе с низким гемоглобином (анемия).", "Ko‘pincha past gemoglobin bilan birga (kamqonlik)."), high: why("Выше нормы бывает при обезвоживании.", "Suvsizlanishda oshadi."), doctor: "family", group: "blood" },
  { id: "hct", ru: "Гематокрит", uz: "Gematokrit", aliases: ["гематокрит", "hct", "gematokrit", "hematocrit"], unit: "%", plausible: [10, 75], ref: [35, 55], doctor: "family", group: "blood" },
  { id: "plt", ru: "Тромбоциты", uz: "Trombotsitlar", aliases: ["тромбоциты", "plt", "trombotsit", "trombotsitlar", "platelets"], unit: "×10⁹/л", plausible: [1, 2000], ref: [150, 450], critical: [20, 1000], low: why("Ниже нормы — риск кровоточивости; бывает после инфекций, на фоне лекарств.", "Qon ketish xavfi; infeksiyalardan keyin, dorilarda bo‘ladi."), high: why("Выше нормы бывает при воспалении, нехватке железа.", "Yallig‘lanish, temir yetishmasligida oshadi."), doctor: "family", group: "blood" },
  { id: "esr", ru: "СОЭ", uz: "EChT", aliases: ["соэ", "esr", "echt", "скорость оседания"], unit: "мм/ч", plausible: [0, 150], ref: [0, 20], high: why("Выше нормы бывает при воспалении, инфекции, беременности.", "Yallig‘lanish, infeksiya, homiladorlikda oshadi."), doctor: "family", group: "inflammation" },
  // ---- Сахар
  { id: "glu", ru: "Глюкоза", uz: "Glyukoza", aliases: ["глюкоза", "сахар крови", "glu", "glucose", "glyukoza", "qand"], unit: "ммоль/л", conv: { "мг/дл": 1 / 18, "mg/dl": 1 / 18, "mmol/l": 1, "ммоль/л": 1 }, plausible: [1, 40], ref: [3.9, 5.5], critical: [3.3, 27.8], low: why("Низкий сахар может вызывать слабость, потливость, дрожь.", "Past qand holsizlik, terlash, titroq beradi."), high: { ru: "Выше нормы. Натощак 5,6–6,9 ммоль/л — предиабет, от 7,0 — критерий диабета (нужна повторная проверка). Обратитесь к семейному врачу.", uz: "Me’yordan yuqori. Och qoringa 5,6–6,9 — prediabet, 7,0 dan — diabet mezoni (qayta tekshirish kerak). Oilaviy shifokorga murojaat qiling." }, doctor: "endocrinology", group: "sugar" },
  { id: "hba1c", ru: "Гликированный гемоглобин (HbA1c)", uz: "Glikirlangan gemoglobin (HbA1c)", aliases: ["hba1c", "гликированный", "гликозилированный", "glikirlangan", "a1c"], unit: "%", plausible: [3, 20], ref: [null, 5.6], high: { ru: "5,7–6,4% — предиабет, от 6,5% — критерий диабета. Обратитесь к семейному врачу.", uz: "5,7–6,4% — prediabet, 6,5% dan — diabet mezoni. Oilaviy shifokorga murojaat qiling." }, doctor: "endocrinology", group: "sugar" },
  // ---- Липиды
  { id: "chol", ru: "Холестерин общий", uz: "Umumiy xolesterin", aliases: ["холестерин общий", "холестерин", "cholesterol", "xolesterin", "chol"], unit: "ммоль/л", conv: { "мг/дл": 1 / 38.67, "mg/dl": 1 / 38.67 }, plausible: [1, 20], ref: [null, 5.2], high: why("Выше нормы повышает риск болезней сердца и сосудов.", "Yurak-qon tomir kasalliklari xavfini oshiradi."), doctor: "cardiology", group: "lipids" },
  { id: "ldl", ru: "ЛПНП («плохой» холестерин)", uz: "LPNP", aliases: ["лпнп", "ldl", "lpnp", "липопротеины низкой"], unit: "ммоль/л", conv: { "мг/дл": 1 / 38.67, "mg/dl": 1 / 38.67 }, plausible: [0.3, 15], ref: [null, 3.0], high: why("Выше нормы повышает риск болезней сердца и сосудов.", "Yurak-qon tomir xavfini oshiradi."), doctor: "cardiology", group: "lipids" },
  { id: "hdl", ru: "ЛПВП («хороший» холестерин)", uz: "LPYuP", aliases: ["лпвп", "hdl", "lpyup", "липопротеины высокой"], unit: "ммоль/л", conv: { "мг/дл": 1 / 38.67, "mg/dl": 1 / 38.67 }, plausible: [0.2, 5], ref: [1.0, null], low: why("Низкий «хороший» холестерин — фактор риска для сердца.", "Past «yaxshi» xolesterin — yurak uchun xavf omili."), doctor: "cardiology", group: "lipids" },
  { id: "tg", ru: "Триглицериды", uz: "Triglitseridlar", aliases: ["триглицериды", "tg", "triglycerides", "triglitserid"], unit: "ммоль/л", conv: { "мг/дл": 1 / 88.57, "mg/dl": 1 / 88.57 }, plausible: [0.1, 30], ref: [null, 1.7], high: why("Выше нормы — фактор риска для сердца и поджелудочной железы.", "Yurak va oshqozon osti bezi uchun xavf omili."), doctor: "cardiology", group: "lipids" },
  // ---- Биохимия
  { id: "creat", ru: "Креатинин", uz: "Kreatinin", aliases: ["креатинин", "creatinine", "kreatinin", "crea"], unit: "мкмоль/л", conv: { "мг/дл": 88.4, "mg/dl": 88.4, "µmol/l": 1, "umol/l": 1, "мкмоль/л": 1 }, plausible: [10, 2000], ref: [45, 110], high: why("Выше нормы бывает при снижении работы почек, обезвоживании.", "Buyrak faoliyati pasayishi, suvsizlanishda oshadi."), doctor: "nephrology", group: "biochem" },
  { id: "urea", ru: "Мочевина", uz: "Mochevina", aliases: ["мочевина", "urea", "mochevina", "bun"], unit: "ммоль/л", plausible: [0.5, 60], ref: [2.5, 8.3], high: why("Выше нормы бывает при обезвоживании, снижении работы почек.", "Suvsizlanish, buyrak faoliyati pasayishida oshadi."), doctor: "nephrology", group: "biochem" },
  { id: "alt", ru: "АЛТ", uz: "ALT", aliases: ["алт", "alt", "алат", "аланинаминотрансфераза", "alat"], unit: "Ед/л", plausible: [1, 5000], ref: [0, 40], high: why("Выше нормы бывает при нагрузке на печень (лекарства, алкоголь, гепатит, жировая печень).", "Jigarga yuklama (dorilar, spirtli ichimlik, gepatit) da oshadi."), doctor: "gastro", group: "biochem" },
  { id: "ast", ru: "АСТ", uz: "AST", aliases: ["аст", "ast", "асат", "аспартатаминотрансфераза", "asat"], unit: "Ед/л", plausible: [1, 5000], ref: [0, 40], high: why("Выше нормы бывает при нагрузке на печень, после физической нагрузки.", "Jigarga yuklama, jismoniy zo‘riqishdan keyin oshadi."), doctor: "gastro", group: "biochem" },
  { id: "bili", ru: "Билирубин общий", uz: "Umumiy bilirubin", aliases: ["билирубин общий", "билирубин", "bilirubin", "tbil"], unit: "мкмоль/л", conv: { "мг/дл": 17.1, "mg/dl": 17.1 }, plausible: [1, 800], ref: [3.4, 20.5], high: why("Выше нормы бывает при болезнях печени, желчных путей.", "Jigar, o‘t yo‘llari kasalliklarida oshadi."), doctor: "gastro", group: "biochem" },
  { id: "k", ru: "Калий", uz: "Kaliy", aliases: ["калий", "potassium", "kaliy", "k+"], unit: "ммоль/л", plausible: [1, 10], ref: [3.5, 5.1], critical: [2.8, 6.2], low: why("Ниже нормы может влиять на работу сердца и мышц.", "Yurak va mushaklar ishiga ta’sir qilishi mumkin."), high: why("Выше нормы может влиять на работу сердца.", "Yurak ishiga ta’sir qilishi mumkin."), doctor: "family", group: "biochem" },
  { id: "na", ru: "Натрий", uz: "Natriy", aliases: ["натрий", "sodium", "natriy", "na+"], unit: "ммоль/л", plausible: [100, 190], ref: [135, 145], critical: [120, 160], doctor: "family", group: "biochem" },
  { id: "ca", ru: "Кальций общий", uz: "Umumiy kalsiy", aliases: ["кальций", "calcium", "kalsiy", "kaltsiy"], unit: "ммоль/л", conv: { "мг/дл": 0.2495, "mg/dl": 0.2495 }, plausible: [0.8, 5], ref: [2.15, 2.55], critical: [1.62, 3.0], doctor: "family", group: "biochem" },
  { id: "crp", ru: "С-реактивный белок (СРБ)", uz: "S-reaktiv oqsil", aliases: ["с-реактивный", "срб", "crp", "s-reaktiv"], unit: "мг/л", plausible: [0, 500], ref: [0, 5], high: why("Выше нормы — признак воспаления или инфекции.", "Yallig‘lanish yoki infeksiya belgisi."), doctor: "family", group: "inflammation" },
  { id: "ferr", ru: "Ферритин", uz: "Ferritin", aliases: ["ферритин", "ferritin"], unit: "нг/мл", conv: { "мкг/л": 1, "µg/l": 1 }, plausible: [1, 5000], ref: [15, 300], low: why("Ниже нормы — признак нехватки железа в организме.", "Organizmda temir yetishmasligi belgisi."), doctor: "family", group: "biochem" },
  { id: "tsh", ru: "ТТГ", uz: "TTG", aliases: ["ттг", "tsh", "ttg", "тиреотропный"], unit: "мЕд/л", conv: { "мкме/мл": 1, "miu/l": 1, "uiu/ml": 1, "мме/л": 1 }, plausible: [0.001, 150], ref: [0.4, 4.0], low: why("Ниже нормы бывает при повышенной работе щитовидной железы.", "Qalqonsimon bez faoliyati oshganda pasayadi."), high: why("Выше нормы бывает при сниженной работе щитовидной железы.", "Qalqonsimon bez faoliyati pasayganda oshadi."), doctor: "endocrinology", group: "thyroid" },
  { id: "inr", ru: "МНО", uz: "XMN", aliases: ["мно", "inr", "xmn"], unit: "", plausible: [0.5, 15], ref: [0.8, 1.2], critical: [null, 5.0], high: why("Выше нормы — кровь сворачивается медленнее (часто на варфарине — врач подбирает свою цель).", "Qon sekinroq ivaydi (varfarin qabul qilinsa, shifokor maqsadni belgilaydi)."), doctor: "family", group: "coag" },
];

const UNIT_RE: [RegExp, string][] = [
  // сначала составные (мг, мкмоль, ммоль…), потом «г/дл», «г/л» — иначе «mg/dL» прочтётся как «g/dL»
  [/(мкмоль|µmol|umol|мкм)\s*\/\s*(л|l)/i, "мкмоль/л"],
  [/(ммоль|mmol)\s*\/\s*(л|l)/i, "ммоль/л"],
  [/(мг|mg)\s*\/\s*(дл|dl)/i, "мг/дл"],
  [/(мг|mg)\s*\/\s*(л|l)(?![a-zа-я])/i, "мг/л"],
  [/(нг|ng)\s*\/\s*(мл|ml)/i, "нг/мл"],
  [/(мкг|µg|ug)\s*\/\s*(л|l)/i, "мкг/л"],
  [/(мкме|uiu|µiu)\s*\/\s*(мл|ml)|(мме|miu|мед|med)\s*\/\s*(л|l)/i, "мЕд/л"],
  [/(^|[^a-zа-яµ])(г|g)\s*\/\s*(дл|dl)/i, "г/дл"],
  [/(^|[^a-zа-яµ])(г|g)\s*\/\s*(л|l)(?![a-zа-я])/i, "г/л"],
  [/(^|[^a-zа-яµ])(ед|u|iu|me)\s*\/\s*(л|l)(?![a-zа-я])/i, "Ед/л"],
  [/(мм|mm)\s*\/\s*(ч|час|h|hr)/i, "мм/ч"],
  [/10\s*[\^*]?\s*9|10⁹/i, "×10⁹/л"],
  [/10\s*[\^*]?\s*12|10¹²/i, "×10¹²/л"],
  [/%/, "%"],
];

export function normNum(s: string): number {
  return parseFloat(s.replace(",", ".").replace(/[OО]/g, "0"));
}

export type Status = "low" | "normal" | "high" | "critical-low" | "critical-high" | "unknown";
export interface LabRow {
  analyte: Analyte;
  raw: string;
  value: number; // как на бланке
  unit: string | null; // как на бланке (распознано)
  canonical: number | null; // в канонической единице
  range: { low: number | null; high: number | null; from: "document" | "builtin" } | null;
  status: Status;
  docFlag?: "H" | "L";
}

/** Псевдо-границы слов для кириллицы: \b в JS понимает только латиницу. */
function findAlias(lineLower: string, a: Analyte): number {
  for (const al of [...a.aliases].sort((x, y) => y.length - x.length)) {
    let i = lineLower.indexOf(al);
    while (i >= 0) {
      const before = i === 0 ? " " : lineLower[i - 1];
      const after = lineLower[i + al.length] ?? " ";
      const short = al.length <= 3;
      const okB = !/[\p{L}]/u.test(before);
      const okA = !/[\p{L}]/u.test(after) || (!short && /[а-яa-z]/.test(after)); // «лейкоциты» ловим и как «лейкоц…»
      if (okB && okA) return i + al.length;
      i = lineLower.indexOf(al, i + 1);
    }
  }
  return -1;
}

function detectUnit(s: string): string | null {
  for (const [re, u] of UNIT_RE) if (re.test(s)) return u;
  return null;
}

function toCanonical(a: Analyte, v: number, unit: string | null): number | null {
  if (unit && a.conv) {
    const k = Object.entries(a.conv).find(([u]) => u.toLowerCase() === unit.toLowerCase())?.[1];
    if (k != null) return v * k;
  }
  if (!unit || unit === a.unit || (a.unit === "Ед/л" && unit === "Ед/л")) {
    // Единица не распознана: гемоглобин 12,8 — скорее г/дл (→ 128 г/л)
    if (a.id === "hgb" && !unit && v < 25) return v * 10;
    return a.plausible && (v < a.plausible[0] || v > a.plausible[1]) ? null : v;
  }
  if (a.unit === "×10⁹/л" && unit === "×10⁹/л") return v;
  if (a.unit === "×10¹²/л" && unit === "×10¹²/л") return v;
  return unit === a.unit ? v : null;
}

/** Разбор строк бланка анализов. */
export function parseLabText(text: string): LabRow[] {
  const out: LabRow[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const line of lines) {
    const lower = line.toLowerCase();
    // Одна строка — один показатель (самое длинное совпадение)
    let best: { a: Analyte; end: number } | null = null;
    for (const a of ANALYTES) {
      const end = findAlias(lower, a);
      if (end >= 0 && (!best || end > best.end)) best = { a, end };
    }
    if (!best || seen.has(best.a.id)) continue;
    let rest = line.slice(best.end).replace(/^\s*\([^)]{1,12}\)/, ""); // «Гемоглобин (HGB) …»
    rest = rest.replace(/\b(hgb|wbc|rbc|plt|hct|hba1c)\b/gi, "");
    // значение — первое число; диапазон «a–b», «< b», «до b», «> a»
    const num = /([<>≤≥]?)\s*(\d+(?:[.,]\d+)?)/.exec(rest);
    if (!num) continue;
    const value = normNum(num[2]);
    if (!Number.isFinite(value)) continue;
    const after = rest.slice(num.index + num[0].length);
    let range: LabRow["range"] = null;
    const r1 = /(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)/.exec(after);
    const r2 = /(?:<|≤|до|менее|less than|gacha)\s*(\d+(?:[.,]\d+)?)/i.exec(after);
    const r3 = /(?:>|≥|более|больше|выше|dan yuqori|more than)\s*(\d+(?:[.,]\d+)?)/i.exec(after);
    // «10^9/л 4,0-9,0»: 10 и 9 из единицы — не диапазон
    const afterNoUnit = after.replace(/(х|x|×|\*)?\s*10\s*[\^*]?\s*(9|12)\s*\/\s*(л|l)/gi, " ");
    const r1b = /(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)/.exec(afterNoUnit);
    if (r1b) range = { low: normNum(r1b[1]), high: normNum(r1b[2]), from: "document" };
    else if (r2) range = { low: null, high: normNum(r2[1]), from: "document" };
    else if (r3) range = { low: normNum(r3[1]), high: null, from: "document" };
    void r1;
    const unit = detectUnit(after) ?? detectUnit(rest);
    const docFlag = /(↑|\bH\b|\(H\)|выше|повыш)/.test(after) ? "H" : /(↓|\bL\b|\(L\)|ниже|пониж)/.test(after) ? "L" : undefined;
    const canonical = toCanonical(best.a, value, unit);
    if (!range && best.a.ref && canonical != null) range = { low: best.a.ref[0], high: best.a.ref[1], from: "builtin" };
    let status: Status = "unknown";
    const cmpV = range?.from === "document" ? value : canonical;
    if (range && cmpV != null) {
      status = range.low != null && cmpV < range.low ? "low" : range.high != null && cmpV > range.high ? "high" : "normal";
    } else if (docFlag) status = docFlag === "H" ? "high" : "low";
    const crit = best.a.critical;
    if (crit && canonical != null) {
      if (crit[0] != null && canonical <= crit[0]) status = "critical-low";
      else if (crit[1] != null && canonical >= crit[1]) status = "critical-high";
    }
    seen.add(best.a.id);
    out.push({ analyte: best.a, raw: line, value, unit, canonical, range, status, docFlag });
  }
  return out;
}

// ---------- Рецепты ----------
export interface RxLine {
  raw: string;
  name: string;
  dose?: string;
  free?: FreeMed;
}
const DOSE = /(\d+(?:[.,]\d+)?\s*(?:мг|mg|мкг|mcg|г|g|мл|ml|ед|me|iu)\b[^,;]*)/iu;
export function parsePrescription(text: string): RxLine[] {
  const out: RxLine[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    const body = l.replace(/^[-•*\s]+/, "").replace(/^(rp\.?|рецепт:?|назначено:?|retsept:?|\d+[.)])\s*/i, "");
    const m = /^([A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ][A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ'‘’ -]{2,40})/u.exec(body);
    if (!m) continue;
    const name = m[1].replace(/\s+(по|таб|капс|tab|kapsula|tabletka)\b.*$/i, "").trim();
    const hits = search(FREE_MEDS, name, (x) => [{ text: x.ru, weight: 1 }, { text: x.uz, weight: 1 }, ...(x.brands ?? []).map((b) => ({ text: b, weight: 0.8 }))], { minCoverage: 0.99 });
    const dose = DOSE.exec(body)?.[1]?.trim();
    if (hits.length || (dose && /(таб|капс|tab|kaps|раз|kuniga|mahal|утром|вечером|ertalab|kechqurun|day|daily)/i.test(body))) {
      out.push({ raw: l, name: hits[0]?.item.ru ?? name, dose, free: hits[0]?.item });
    }
  }
  return out;
}

// ---------- Выписки / заключения: диагноз, МКБ-10, рекомендации ----------
const ICD_CHAPTERS: [string, string, string, string][] = [
  ["A00", "B99", "Инфекционные и паразитарные болезни", "Yuqumli va parazitar kasalliklar"],
  ["C00", "D48", "Новообразования", "O‘smalar"],
  ["D50", "D89", "Болезни крови и иммунной системы", "Qon va immun tizimi kasalliklari"],
  ["E00", "E90", "Эндокринные болезни, питание, обмен веществ", "Endokrin, ovqatlanish va modda almashinuvi"],
  ["F00", "F99", "Психические расстройства", "Ruhiy buzilishlar"],
  ["G00", "G99", "Болезни нервной системы", "Asab tizimi kasalliklari"],
  ["H00", "H59", "Болезни глаза", "Ko‘z kasalliklari"],
  ["H60", "H95", "Болезни уха", "Quloq kasalliklari"],
  ["I00", "I99", "Болезни системы кровообращения", "Qon aylanish tizimi kasalliklari"],
  ["J00", "J99", "Болезни органов дыхания", "Nafas olish a’zolari kasalliklari"],
  ["K00", "K93", "Болезни органов пищеварения", "Hazm a’zolari kasalliklari"],
  ["L00", "L99", "Болезни кожи", "Teri kasalliklari"],
  ["M00", "M99", "Болезни костно-мышечной системы", "Suyak-mushak tizimi kasalliklari"],
  ["N00", "N99", "Болезни мочеполовой системы", "Siydik-tanosil tizimi kasalliklari"],
  ["O00", "O99", "Беременность и роды", "Homiladorlik va tug‘ruq"],
  ["P00", "P96", "Состояния перинатального периода", "Perinatal davr holatlari"],
  ["Q00", "Q99", "Врождённые аномалии", "Tug‘ma nuqsonlar"],
  ["R00", "R99", "Симптомы и отклонения, не классифицированные в других рубриках", "Boshqa joyda tasniflanmagan alomatlar"],
  ["S00", "T98", "Травмы и отравления", "Jarohatlar va zaharlanishlar"],
  ["V01", "Y98", "Внешние причины", "Tashqi sabablar"],
  ["Z00", "Z99", "Факторы, влияющие на здоровье, обращения", "Sog‘liqqa ta’sir etuvchi omillar"],
];
export function icdChapter(code: string): { ru: string; uz: string } | null {
  const c = code.toUpperCase().slice(0, 3);
  const hit = ICD_CHAPTERS.find(([a, b]) => c >= a && c <= b);
  return hit ? { ru: hit[2], uz: hit[3] } : null;
}

export interface DocSummary {
  diagnosis: string[];
  icd: { code: string; chapter: { ru: string; uz: string } }[];
  recommendations: string[];
  dates: string[];
}
export function parseMedicalDoc(text: string): DocSummary {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const diagnosis: string[] = [];
  const recommendations: string[] = [];
  let mode: "dx" | "rec" | null = null;
  for (const l of lines) {
    if (/^(клинический |основной |заключительный |сопутствующий )?диагноз|^tashxis|^diagnosis|^заключение/i.test(l)) {
      mode = "dx";
      const rest = l.replace(/^[^:]*:\s*/, "");
      if (rest && rest !== l) diagnosis.push(rest);
      continue;
    }
    if (/^(рекомендовано|рекомендации|рекомендуется|tavsiya|tavsiyalar|recommendations?)/i.test(l)) {
      mode = "rec";
      const rest = l.replace(/^[^:]*:\s*/, "");
      if (rest && rest !== l) recommendations.push(rest);
      continue;
    }
    if (/^[А-ЯA-ZЎҚҒҲ][а-яa-zўқғҳ ]{3,30}:/.test(l)) mode = null; // новый раздел
    if (mode === "dx" && parseLabText(l).length) continue; // строки анализов — не диагноз
    if (mode === "dx" && diagnosis.length < 5) diagnosis.push(l);
    else if (mode === "rec" && recommendations.length < 12) recommendations.push(l.replace(/^[-•*\d.)]+\s*/, ""));
  }
  const icd = [...new Set([...text.matchAll(/\b([A-TV-Z]\d{2}(?:\.\d{1,2})?)\b/g)].map((m) => m[1]))]
    .map((code) => ({ code, chapter: icdChapter(code) }))
    .filter((x): x is { code: string; chapter: { ru: string; uz: string } } => !!x.chapter)
    .slice(0, 10);
  const dates = [...new Set([...text.matchAll(/\b(\d{2}[./]\d{2}[./]\d{4})\b/g)].map((m) => m[1]))].slice(0, 5);
  return { diagnosis, icd, recommendations, dates };
}

export type DocKind = "lab" | "prescription" | "discharge" | "document" | "unknown";
export interface Analysis {
  kind: DocKind;
  labs: LabRow[];
  rx: RxLine[];
  doc: DocSummary;
  urgent: boolean;
  abnormal: number;
}

export function analyzeText(text: string): Analysis {
  const labs = parseLabText(text);
  const rx = parsePrescription(text);
  const doc = parseMedicalDoc(text);
  const t = text.toLowerCase();
  const kind: DocKind =
    /(выписка|эпикриз|ko‘chirma|ko'chirma|epikriz|discharge summary)/.test(t)
      ? "discharge"
      : labs.length >= 2 || /(анализ|tahlil|blood test|референс|норма)/.test(t) && labs.length
      ? "lab"
      : /(выписка|эпикриз|заключение|ko‘chirma|ko'chirma|epikriz|xulosa|discharge)/.test(t) || doc.diagnosis.length
        ? "discharge"
        : rx.length
          ? "prescription"
          : text.trim().length > 20
            ? "document"
            : "unknown";
  return {
    kind,
    labs,
    rx,
    doc,
    urgent: labs.some((l) => l.status.startsWith("critical")),
    abnormal: labs.filter((l) => l.status !== "normal" && l.status !== "unknown").length,
  };
}
