// «Медкарта для экстренных случаев»: хранится ТОЛЬКО на этом устройстве (localStorage), на сервер не отправляется.
export interface MedCard {
  name: string;
  birthYear: string;
  bloodType: string;
  allergies: string;
  conditions: string;
  medications: string;
  contactName: string;
  contactPhone: string;
  notes: string;
}

export const EMPTY_CARD: MedCard = { name: "", birthYear: "", bloodType: "", allergies: "", conditions: "", medications: "", contactName: "", contactPhone: "", notes: "" };
export const BLOOD_TYPES = ["O(I) Rh+", "O(I) Rh−", "A(II) Rh+", "A(II) Rh−", "B(III) Rh+", "B(III) Rh−", "AB(IV) Rh+", "AB(IV) Rh−"];
const KEY = "bm_medcard";
const LIMIT = 300;

export function loadCard(): MedCard {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<MedCard> | null;
    if (!raw || typeof raw !== "object") return { ...EMPTY_CARD };
    const out = { ...EMPTY_CARD };
    for (const k of Object.keys(EMPTY_CARD) as (keyof MedCard)[]) if (typeof raw[k] === "string") out[k] = raw[k]!.slice(0, LIMIT);
    return out;
  } catch {
    return { ...EMPTY_CARD };
  }
}

export function saveCard(c: MedCard): boolean {
  const clean = { ...EMPTY_CARD };
  for (const k of Object.keys(EMPTY_CARD) as (keyof MedCard)[]) clean[k] = (c[k] ?? "").trim().slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

export function clearCard(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* нет хранилища */
  }
}

export const isEmptyCard = (c: MedCard) => Object.values(c).every((v) => !v.trim());

/** Телефон для tel:/sms: — только цифры и ведущий «+». */
export function cleanPhone(p: string): string {
  const s = p.trim().replace(/[^\d+]/g, "");
  return s.startsWith("+") ? "+" + s.slice(1).replace(/\+/g, "") : s.replace(/\+/g, "");
}

export function mapsLink(lat: number, lon: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/** Текст SOS-сообщения близкому: где я + главное из медкарты. */
export function sosMessage(lang: "ru" | "uz", c: MedCard, pos: { lat: number; lon: number } | null): string {
  const L =
    lang === "uz"
      ? { head: "🆘 Menga yordam kerak!", where: "Mening joylashuvim", noWhere: "Joylashuvni aniqlab bo‘lmadi", blood: "Qon guruhi", allergy: "Allergiya", cond: "Kasalliklar", meds: "Dorilar" }
      : { head: "🆘 Мне нужна помощь!", where: "Моё местоположение", noWhere: "Местоположение определить не удалось", blood: "Группа крови", allergy: "Аллергия", cond: "Заболевания", meds: "Лекарства" };
  const lines = [L.head];
  if (c.name) lines.push(c.name + (c.birthYear ? `, ${c.birthYear}` : ""));
  lines.push(pos ? `${L.where}: ${mapsLink(pos.lat, pos.lon)}` : L.noWhere);
  if (c.bloodType) lines.push(`${L.blood}: ${c.bloodType}`);
  if (c.allergies) lines.push(`${L.allergy}: ${c.allergies}`);
  if (c.conditions) lines.push(`${L.cond}: ${c.conditions}`);
  if (c.medications) lines.push(`${L.meds}: ${c.medications}`);
  lines.push("— BepulMed AI");
  return lines.join("\n");
}
