// Разбор фразы помощника: что хочет человек и какую функцию приложения открыть. Работает офлайн, чистая функция.
import { triage } from "../../../worker/src/triage";
import { FIRST_AID } from "../data/firstAid";
import { norm, search } from "./search";

export type VoiceIntent =
  | { kind: "firstaid"; id: string; urgent: boolean }
  | { kind: "emergency" }
  | { kind: "call"; number: string }
  | { kind: "sos" }
  | { kind: "medcard" }
  | { kind: "scanner" }
  | { kind: "offline" }
  | { kind: "dmed" }
  | { kind: "meds"; query: string }
  | { kind: "facility"; query: string; near: boolean }
  | { kind: "pharmacy"; openNow: boolean }
  | { kind: "book" }
  | { kind: "tickets" }
  | { kind: "lang"; lang: "ru" | "uz" }
  | { kind: "help" }
  | { kind: "chat" };

const has = (s: string, re: RegExp) => re.test(s);

/** Лучшая инструкция первой помощи для описания ситуации (или null). */
// Служебные слова вопроса «что делать, если…» не должны снижать совпадение с инструкцией.
const AID_FILLER = /(^|[\s,.!?])(что|чё|делать|сделать|делаю|если|как|быстро|срочно|помочь|помогите|помощь|первая|первую|оказать|человек|человеку|у|меня|qilish|qilsa|kerak|agar|qoldi|qoldim|birinchi|yordam|tez|nima|qanday)(?=$|[\s,.!?])/giu;

// Общие слова (боль, части тела), которые сами по себе не указывают на конкретную ситуацию.
const GENERIC = /(^|[\s,.!?])(болит|болят|боль|больно|сильно|очень|рука|руки|руку|ноги|нога|ногу|палец|пальца|пальцы|голова|голову|живот|спина|og ?riyapti|og'riyapti|qo'l|qo‘l|oyoq|bosh|qorin|ребенок|ребенка|ребёнок|ребёнка|ребенку|ребёнку|bola|bolam|bolaning|сахар|qand|укусил|укусила|укус|tishladi|горло|tomoq|кашель|температура|давление|bosim|isitma|yo'tal)(?=$|[\s,.!?])/giu;

/** Подсказка «похоже на…» для неуверенного совпадения: общие слова не учитываются. */
export function suggestAid(text: string) {
  const core = text.replace(AID_FILLER, " ").replace(GENERIC, " ").trim();
  return core.length >= 3 ? bestAid(core, 0.5) : null;
}

export function bestAid(text: string, minScore = 0.85) {
  const core = text.replace(AID_FILLER, " ").trim();
  const hits = search(FIRST_AID, core || text, (g) => [
    { text: g.keys.join(" "), weight: 1 },
    { text: `${g.ru.title} ${g.uz.title}`, weight: 0.9 },
  ]);
  const top = hits[0];
  return top && top.score >= minScore ? top.item : null;
}

export function routeVoice(text: string): VoiceIntent {
  const s = ` ${norm(text)} `;

  // 1. Угроза жизни — сразу нужная инструкция + 103.
  if (triage(text).emergency) {
    const g = bestAid(text, 0.5);
    return g ? { kind: "firstaid", id: g.id, urgent: true } : { kind: "emergency" };
  }
  // 2. Позвонить
  if (has(s, /(pozvon|vizov|naberi|qo ngiroq|qongiroq|chaqir).{0,30}(skoru|103|tez yordam|vrach|112)|(skoruyu|tez yordam) (pozvon|vizov|chaqir)/)) {
    return { kind: "call", number: has(s, / 112 /) ? "112" : "103" };
  }
  // 3. Язык
  if (has(s, /(govori|perekluch|pereydi|yaz|gapir|til).{0,20}(uzbek|ozbek)|o zbekcha|ozbekcha gapir/)) return { kind: "lang", lang: "uz" };
  if (has(s, /(govori|perekluch|gapir|til).{0,20}(rus)|ruscha gapir|po russki/)) return { kind: "lang", lang: "ru" };
  // 4. Что умеешь
  if (has(s, /chto ti umeesh|chto umeesh|chem mojesh pomoch|nima qila olasan|yordam bera olasan|kak toboy polzovat/)) return { kind: "help" };
  // 5. Первая помощь: «что делать при ожоге», «порезался», «ребёнок подавился»
  const aidWords = has(s, /chto delat|pervaya pomosh|pervuyu pomosh|kak pomoch|nima qilish|birinchi yordam|qanday yordam/);
  const aid = bestAid(text, aidWords ? 0.6 : 0.95);
  const otherFn = has(s, /lekarstv|tabletk|dori|poliklinik|bolnits|klinik|zapis|talon|apte/);
  if (aid && !otherFn) return { kind: "firstaid", id: aid.id, urgent: aid.urgent };

  if (has(s, /dmed|d med|dimed|elektron retsept|elektronn\w* retsept|moi retsept|retseptlarim/)) return { kind: "dmed" };
  if (has(s, /oflayn|offlayn|ofl[ae]yn|bez interneta|bez seti|internetsiz|net interneta|internet yo q/) && !otherFn) return { kind: "offline" };
  if (has(s, / sos | pomogite | yordam bering |gde ya |otprav.{0,20}(mesto|lokats|geo)|joylashuv.{0,10}yubor/)) return { kind: "sos" };
  if (has(s, /medkart|gruppa krovi|moya kart|tibbiy karta|qon guruh|allergi.{0,10}(moi|mening)/)) return { kind: "medcard" };
  if (has(s, /skaner|skanir|sfotograf.{0,20}(retsept|analiz|dokument)|raspoznat|retseptni|tahlilni o qi/)) return { kind: "scanner" };
  if (has(s, / (moi |mening )?talon/)) return { kind: "tickets" };
  if (has(s, /zapis|zapisat|yozil|navbatga/)) return { kind: "book" };
  if (has(s, /apte[kc]|dorixona/)) return { kind: "pharmacy", openNow: has(s, /otkrit|seychas|rabota|kruglosut|24 ?(7|chasa)|nochn|hozir|ochiq|tunda|kechasi/) };
  if (has(s, /lekarstv|tabletk|preparat|dori|tabletka|medikament|insulin|ukol|ingalyator/)) return { kind: "meds", query: text };

  // Вопрос «как/можно ли/qanday…» без «где/найди» — помощнику, а не поиск адреса.
  const question = has(s, /^ (kak|chto|mojno|skolko|pochemu|zachem|kogda|nujno li|qanday|nima|nega|qachon|mumkinmi|kerakmi) /) && !has(s, /gde|naydi|adres|qayerda|qayer|manzil|topib|blijaysh|ryadom|yaqin/);
  if (question) return { kind: "chat" };
  if (has(s, /poliklinik|bolnits|klinik|shifoxon|kasalxon|markaz|tsentr|gospital|travmpunkt|vrach|doktor|shifokor|kardiolog|endokrinolog|nevrolog|onkolog|okulist|oftalmolog|ginekolog|urolog|dermatolog|pulmonolog|nefrolog|ortoped|lor |kuda idti|qayerga bor|blijaysh|ryadom|yaqin/))
    return { kind: "facility", query: text, near: has(s, /blijaysh|ryadom|yaqin|okolo menya|poblizosti/) };
  return { kind: "chat" };
}
