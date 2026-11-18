import { normalize } from "./kb";

// Детектор возможных неотложных состояний. Срабатывает ДО обращения к ИИ.
// Лучше ложное срабатывание, чем пропуск: при совпадении показываем 103/112.

const PATTERNS: RegExp[] = [
  // RU
  /бол[ьи]\S*(\s+\S+){0,2}\s+(в|за)\s+груд/,
  /болит(\s+\S+){0,2}\s+(в\s+)?груд/,
  /(^|\s)(грудь|груди|грудина|грудине)(\s+\S+){0,2}\s+(болит|давит|жжет|сжимает)/,
  /давит\s+(в|за)\s+груд/,
  /не\s+мо(гу|жет)\s+дыш/,
  /задыха/,
  /нечем\s+дышать/,
  /потерял\S*\s+сознани/,
  /без\s+сознани/,
  /упал\S*\s+в\s+обморок/,
  /инсульт/,
  /инфаркт/,
  /перекосил/,
  /онемел\S*\s+(рук|ног|лиц|половин)/,
  /не\s+мо(гу|жет)\s+говорить/,
  /сильн\S*\s+кровотечени/,
  /кровь\s+не\s+останавлива/,
  /судорог/,
  /припад/,
  /отравлени/,
  /передозиров/,
  /анафилак/,
  /отек\S*\s+(горла|гортани|языка|лица)/,
  /сильн\S*\s+ожог/,
  /кровотечени\S*.*беремен|беремен\S*.*кровотечени/,
  /ребенок\s+не\s+дышит|ребёнок\s+не\s+дышит/,
  /суицид/,
  /покончить\s+с\s+собой/,
  /не\s+хочу\s+жить/,
  // UZ (латиница)
  /ko'kra\S*(\s+\S+){0,2}\s+og'ri/,
  /yurag\S*(\s+\S+){0,2}\s+og'ri/,
  /nafas\s+(ololma|ola\s+olma|olishga\s+qiyna)/,
  /nafas\s+qis/,
  /bo'g'il/,
  /hushi\S*(\s+\S+){0,2}\s+ket/,
  /hushsiz/,
  /insult/,
  /infarkt/,
  /qon(\s+\S+){0,2}\s+ketyap/,
  /qon\s+to'xtama/,
  /tutqanoq/,
  /zaharlan/,
  /o'z\s+joniga\s+qasd/,
  /yashagim\s+kelmay/,
  // UZ (кириллица)
  /кўкра\S*(\s+\S+){0,2}\s+оғри/,
  /юраг\S*(\s+\S+){0,2}\s+оғри/,
  /нафас\s+ол/,
  /ҳушидан\s+кет/,
  /қон\s+кетяп/,
];

const SELF_HARM: RegExp[] = [/суицид/, /покончить\s+с\s+собой/, /не\s+хочу\s+жить/, /o'z\s+joniga\s+qasd/, /yashagim\s+kelmay/];

export interface TriageResult {
  emergency: boolean;
  selfHarm: boolean;
}

export function triage(text: string): TriageResult {
  const t = normalize(text);
  const emergency = PATTERNS.some((p) => p.test(t));
  const selfHarm = SELF_HARM.some((p) => p.test(t));
  return { emergency: emergency || selfHarm, selfHarm };
}

export function emergencyMessage(lang: "ru" | "uz", selfHarm: boolean): string {
  if (lang === "uz") {
    return selfHarm
      ? "Siz hozir og‘ir holatdasiz va bu juda muhim. Iltimos, hoziroq 103 (tez yordam) yoki 112 ga qo‘ng‘iroq qiling yoki yaqin odamingizga yoningizda bo‘lishini so‘rang. Siz yolg‘iz emassiz."
      : "Siz tasvirlagan belgilar shoshilinch holat bo‘lishi mumkin. Navbat kutmang va o‘zingiz tashxis qo‘ymang — hoziroq 103 (tez yordam) yoki 112 ga qo‘ng‘iroq qiling.";
  }
  return selfHarm
    ? "Похоже, вам сейчас очень тяжело, и это важно. Пожалуйста, прямо сейчас позвоните 103 (скорая) или 112, либо попросите близкого человека побыть рядом. Вы не одни."
    : "Описанные симптомы могут быть признаком неотложного состояния. Не ждите очереди и не ставьте диагноз самостоятельно — немедленно позвоните 103 (скорая помощь) или 112.";
}
