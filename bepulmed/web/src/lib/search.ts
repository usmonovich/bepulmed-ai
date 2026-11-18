// Нечёткий поиск по-русски и по-узбекски (кириллица и латиница), без сервера.
// «от давления», «bosim uchun», «конкор», «бисапролол» (с опечаткой) — всё находит нужное.

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h",
};

/** Нижний регистр → латиница → без апострофов и знаков. */
export function norm(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase()) out += CYR[ch] ?? ch;
  return out
    .replace(/[ʻʼ‘’'`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Служебные слова запроса (уже в нормализованном виде).
const STOP = new Set(
  [
    "от", "из", "во", "со", "к", "о", "об", "же", "не", "для", "при", "по", "на", "и", "или", "в", "с", "у", "меня", "мне", "есть", "ли", "какие", "какое", "какой", "что", "нужно", "надо", "хочу", "найди", "найти", "покажи",
    "лекарство", "лекарства", "лекарств", "таблетки", "таблетка", "таблеток", "препарат", "препараты", "бесплатно", "бесплатные", "бесплатное", "бесплатный", "средство",
    "uchun", "dori", "dorilar", "dorini", "tabletka", "tabletkalar", "bepul", "qanday", "menga", "kerak", "bor", "va", "yoki", "qaysi", "nima", "top", "korsat", "preparat",
  ].map(norm),
);

export function tokens(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

/** Расстояние Дамерау–Левенштейна (ограниченное) для опечаток. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Насколько слово запроса q похоже на слово текста t: 0…1. Учитывает окончания и опечатки. */
export function tokenMatch(q: string, t: string): number {
  if (q === t) return 1;
  if (q.length >= 3 && t.startsWith(q)) return 0.9; // «давл» → «давление»
  if (t.length >= 4 && q.startsWith(t)) return 0.85;
  let p = 0;
  while (p < q.length && p < t.length && q[p] === t[p]) p++;
  if (p >= 5 && p >= Math.min(q.length, t.length) * 0.7) return 0.8; // «давления» ↔ «давление», «сахарный» ↔ «сахар»
  const max = Math.min(q.length, t.length) >= 7 ? 2 : Math.min(q.length, t.length) >= 4 ? 1 : 0;
  if (max && q[0] === t[0] && editDistance(q, t, max) <= max) return 0.7; // «бисапролол» → «бисопролол»
  return 0;
}

export interface Field {
  text: string;
  weight: number;
}

export interface Hit<T> {
  item: T;
  score: number;
  matched: string[]; // какие поля сработали (для подсказки «почему найдено»)
}

/** Ранжирует элементы: каждое слово запроса ищется во всех полях, берётся лучшее совпадение с учётом веса поля. */
export function search<T>(items: readonly T[], query: string, fields: (item: T) => Field[], opts: { minCoverage?: number } = {}): Hit<T>[] {
  const q = tokens(query);
  if (!q.length) return [];
  const minCoverage = opts.minCoverage ?? 0.5;
  const out: Hit<T>[] = [];
  for (const item of items) {
    const fs = fields(item).map((f) => ({ ...f, toks: norm(f.text).split(" ").filter(Boolean) }));
    let score = 0;
    let covered = 0;
    const matched = new Set<string>();
    for (const qt of q) {
      let best = 0;
      let bestField = "";
      for (const f of fs) {
        for (const t of f.toks) {
          const m = tokenMatch(qt, t) * f.weight;
          if (m > best) {
            best = m;
            bestField = f.text;
          }
        }
      }
      if (best > 0) {
        covered++;
        score += best;
        matched.add(bestField);
      }
    }
    if (covered / q.length >= minCoverage && score > 0) out.push({ item, score: score * (covered / q.length), matched: [...matched] });
  }
  return out.sort((a, b) => b.score - a.score);
}
