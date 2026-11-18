import { normalize } from "./kb";

// Детерминированное распознавание намерения «записаться к специалисту».
// ИИ не создаёт записи: сервер лишь предлагает кнопку, а пациент сам выбирает слот и подтверждает.

export type Specialty = "therapy" | "cardiology";

const SPECIALTY_WORDS: Record<Specialty, string[]> = {
  cardiology: ["кардиолог", "kardiolog", "кардиологу", "кардиологом", "кардиолога"],
  therapy: ["терапевт", "terapevt", "семейн", "oilaviy shifokor", "oilaviy vrach", "участков", "врач общей"],
};

// Сильные слова — явная просьба о записи; слабые («нужен», «kerak») — только вместе со словом «врач».
const STRONG = ["записат", "запиши", "записа", "на приём", "на прием", "талон", "qabul", "yozil"];
const WEAK = ["нужен", "нужна", "попасть к", "kerak", "bormi", "uchrash"];
const DOCTOR = /(врач|vrach|shifokor|doktor|доктор)/;

export interface Intent {
  type: "find_doctor";
  specialty: Specialty | null;
}

export function detectIntent(text: string): Intent | null {
  const t = normalize(text);
  for (const [sp, words] of Object.entries(SPECIALTY_WORDS) as [Specialty, string[]][]) {
    if (words.some((w) => t.includes(w))) return { type: "find_doctor", specialty: sp };
  }
  if (STRONG.some((w) => t.includes(w))) return { type: "find_doctor", specialty: null };
  if (WEAK.some((w) => t.includes(w)) && DOCTOR.test(t)) return { type: "find_doctor", specialty: null };
  return null;
}
