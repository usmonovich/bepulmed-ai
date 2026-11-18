// Проверенная база источников. Каждая запись — краткое изложение документа
// своими словами + ссылка. ИИ отвечает ТОЛЬКО на основе этих записей.
// checked — дата, когда команда последний раз сверяла запись с источником.

export type Lang = "ru" | "uz";

export interface KbEntry {
  id: string;
  title: Record<Lang, string>;
  url: string;
  official: boolean; // true — первоисточник (lex.uz, gov.uz); false — СМИ/вторичный
  checked: string; // YYYY-MM-DD
  keywords: string[]; // нижний регистр, ru + uz (латиница)
  text: Record<Lang, string>;
}

export const KB: KbEntry[] = [
  {
    id: "pp-311",
    title: {
      ru: "Постановление Президента № ПП-311 от 05.09.2024 «О мерах по внедрению механизмов государственного медицинского страхования»",
      uz: "Prezidentning 05.09.2024 yildagi PQ-311-son qarori «Davlat tibbiy sug‘urtasi mexanizmlarini joriy etish chora-tadbirlari to‘g‘risida»",
    },
    url: "https://lex.uz/docs/7098109",
    official: true,
    checked: "2026-11-17",
    keywords: [
      "страхование", "страховка", "фгмс", "фонд", "гарантированный", "пакет", "бесплатн",
      "государств", "ташкент", "сырдарь", "sug'urta", "sugurta", "bepul", "kafolatlangan", "paket", "davlat", "toshkent", "sirdaryo",
    ],
    text: {
      ru: "ПП-311 вводит государственное медицинское страхование. Первыми регионами внедрения названы город Ташкент и Сырдарьинская область (с 1 октября 2024 года). Оплата медицинской помощи в рамках гарантированного пакета идёт через Фонд государственного медицинского страхования (ФГМС). Конкретный перечень бесплатных услуг определяется отдельными постановлениями о гарантированном объёме помощи.",
      uz: "PQ-311 davlat tibbiy sug‘urtasini joriy etadi. Dastlab Toshkent shahri va Sirdaryo viloyatida (2024-yil 1-oktabrdan) joriy etilgan. Kafolatlangan paket doirasidagi tibbiy yordam Davlat tibbiy sug‘urta jamg‘armasi (DTSJ) orqali to‘lanadi. Bepul xizmatlarning aniq ro‘yxati kafolatlangan hajm to‘g‘risidagi alohida qarorlar bilan belgilanadi.",
    },
  },
  {
    id: "km-382",
    title: {
      ru: "Постановление Кабинета Министров № 382 от 19.06.2025 о гарантированных объёмах медицинской помощи в учреждениях ПМСП",
      uz: "Vazirlar Mahkamasining 19.06.2025 yildagi 382-son qarori — birlamchi tibbiy-sanitariya yordami muassasalarida kafolatlangan hajmlar",
    },
    url: "https://lex.uz/docs/7585474",
    official: true,
    checked: "2026-11-17",
    keywords: [
      "поликлиник", "семейн", "врач", "пмсп", "первичн", "гарантированный", "объем", "объём", "пакет", "бесплатн", "направлени",
      "прикреплени", "экг", "анализ", "обследование", "плановая", "плановой", "oilaviy", "poliklinika", "shifokor", "birlamchi",
      "yo'llanma", "yollanma", "biriktir", "bepul", "ekg", "tahlil", "tekshiruv", "обратиться", "куда идти", "куда", "qayerga", "murojaat",
    ],
    text: {
      ru: "Постановление № 382 утверждает гарантированные объёмы медицинской помощи, оплачиваемые из Государственного бюджета, в учреждениях первичной медико-санитарной помощи (семейные поликлиники). Вступило в силу 20.06.2025 и заменило прежнее постановление. Для плановой помощи пациент обращается в поликлинику, к которой прикреплён; дальнейшие обследования и консультации, как правило, назначаются семейным врачом по показаниям через направление. Бесплатность конкретной услуги (например, ЭКГ) зависит от того, входит ли она в утверждённый перечень и есть ли медицинские показания — это подтверждает врач.",
      uz: "382-son qaror birlamchi tibbiy-sanitariya yordami muassasalarida (oilaviy poliklinikalar) Davlat byudjeti hisobidan qoplanadigan kafolatlangan tibbiy yordam hajmlarini tasdiqlaydi. 20.06.2025 dan kuchga kirgan. Rejali yordam uchun bemor o‘zi biriktirilgan poliklinikaga murojaat qiladi; keyingi tekshiruv va konsultatsiyalar odatda ko‘rsatma bo‘yicha oilaviy shifokor yo‘llanmasi orqali tayinlanadi. Muayyan xizmatning (masalan, EKG) bepulligi u tasdiqlangan ro‘yxatga kirishi va tibbiy ko‘rsatma borligiga bog‘liq — buni shifokor tasdiqlaydi.",
    },
  },
  {
    id: "km-619",
    title: {
      ru: "Постановление Кабинета Министров № 619 от 02.10.2024 «Об утверждении Положения о программе реимбурсации по возмещению затрат на лекарственные средства»",
      uz: "Vazirlar Mahkamasining 02.10.2024 yildagi 619-son qarori — dori vositalari xarajatlarini qoplash (reimbursatsiya) dasturi to‘g‘risidagi Nizom",
    },
    url: "https://lex.uz/ru/docs/7135951",
    official: true,
    checked: "2026-11-17",
    keywords: [
      "лекарств", "лекарство", "препарат", "аптек", "аптека", "рецепт", "реимбурсац", "бесплатн", "возмещени", "таблетк",
      "dori", "apteka", "dorixona", "retsept", "reimburs", "bepul", "tabletka",
    ],
    text: {
      ru: "Программа реимбурсации: пациент бесплатно получает в аптеке лекарства для амбулаторного лечения по электронному рецепту. Рецепт выписывает врач учреждения первичной помощи в онлайн-системе, указывая международное непатентованное наименование (МНН). По данным публикаций о документе, рецепт действует около недели; при получении аптека активирует рецепт, а пациенту приходит SMS-код. Затраты аптеке возмещает ФГМС — поэтому лекарство выдаётся только в аптеках, заключивших договор с Фондом. Перечень заболеваний и лекарств утверждает Минздрав.",
      uz: "Reimbursatsiya dasturi: bemor ambulator davolanish uchun dorilarni elektron retsept asosida dorixonadan bepul oladi. Retseptni birlamchi tibbiyot muassasasi shifokori onlayn tizimda xalqaro patentlanmagan nomini (XPN) ko‘rsatib yozadi. Hujjat haqidagi nashrlarga ko‘ra retsept taxminan bir hafta amal qiladi; dorixona retseptni faollashtiradi va bemorga SMS-kod keladi. Xarajatlarni DTSJ qoplaydi — shuning uchun dori faqat Jamg‘arma bilan shartnoma tuzgan dorixonalarda beriladi. Kasalliklar va dorilar ro‘yxatini Sog‘liqni saqlash vazirligi tasdiqlaydi.",
    },
  },
  {
    id: "moh-69",
    title: {
      ru: "Перечень 69 лекарств для бесплатного обеспечения при хронических заболеваниях (приказ Минздрава, сообщение Kun.uz от 05.05.2026)",
      uz: "Surunkali kasalliklar uchun bepul beriladigan 69 ta dori ro‘yxati (SSV buyrug‘i, Kun.uz xabari, 05.05.2026)",
    },
    url: "https://kun.uz/en/news/2026/05/05/uzbekistan-approves-list-of-free-medications-for-chronic-and-serious-diseases",
    official: false,
    checked: "2026-11-17",
    keywords: [
      "лекарств", "перечень", "список", "хроническ", "аспирин", "бисопролол", "омепразол", "трамадол", "амброксол", "гепарин",
      "калия йодид", "давлени", "сердц", "диабет", "онколог", "dori", "ro'yxat", "royxat", "surunkali", "aspirin", "bisoprolol",
      "omeprazol", "tramadol", "ambroksol", "geparin", "qon bosimi", "yurak", "diabet",
    ],
    text: {
      ru: "По сообщению Kun.uz, приказом министра здравоохранения (по согласованию с ФГМС) утверждён перечень из 69 лекарств для бесплатного обеспечения при хронических и тяжёлых заболеваниях (в т.ч. онкологических, психических, сердечно-сосудистых, эндокринных). Среди названных препаратов: аспирин, бисопролол, омепразол, трамадол, амброксол, калия йодид, гепарин. Начало действия программы — 1 января 2027 года. Выдача — по электронному рецепту семейного врача в аптеках, имеющих договор с ФГМС. Это вторичный источник: полный перечень нужно сверять с приказом Минздрава.",
      uz: "Kun.uz xabariga ko‘ra, sog‘liqni saqlash vaziri buyrug‘i bilan (DTSJ bilan kelishilgan holda) surunkali va og‘ir kasalliklar (onkologik, ruhiy, yurak-qon tomir, endokrin va boshqalar) uchun bepul beriladigan 69 ta dori ro‘yxati tasdiqlangan. Nomlari keltirilganlar: aspirin, bisoprolol, omeprazol, tramadol, ambroksol, kaliy yodid, geparin. Dastur 2027-yil 1-yanvardan boshlanadi. Dori oilaviy shifokorning elektron retsepti bo‘yicha DTSJ bilan shartnomasi bor dorixonalarda beriladi. Bu ikkilamchi manba: to‘liq ro‘yxatni SSV buyrug‘i bilan solishtirish kerak.",
    },
  },
  {
    id: "emergency",
    title: {
      ru: "Экстренные номера Узбекистана: 103 — скорая помощь, 112 — единая служба",
      uz: "O‘zbekiston favqulodda raqamlari: 103 — tez yordam, 112 — yagona xizmat",
    },
    url: "https://www.gov.uk/foreign-travel-advice/uzbekistan/getting-help",
    official: false,
    checked: "2026-11-17",
    keywords: [
      "скорая", "103", "112", "экстрен", "неотложн", "срочно", "вызвать", "tez yordam", "favqulodda", "shoshilinch", "chaqir",
    ],
    text: {
      ru: "Скорая медицинская помощь — 103 (круглосуточно, бесплатно). Единый номер экстренных служб — 112. При угрозе жизни не ищите поликлинику и не ждите очереди — сразу звоните 103 или 112. Экстренная помощь не требует направления и прикрепления.",
      uz: "Tez tibbiy yordam — 103 (kecha-kunduz, bepul). Favqulodda xizmatlarning yagona raqami — 112. Hayotga xavf bo‘lsa, poliklinika qidirmang va navbat kutmang — darhol 103 yoki 112 ga qo‘ng‘iroq qiling. Shoshilinch yordam yo‘llanma va biriktirishni talab qilmaydi.",
    },
  },
  {
    id: "erecipe",
    title: {
      ru: "Электронный рецепт: поэтапный переход (Минздрав, публикации 2025–2026)",
      uz: "Elektron retsept: bosqichma-bosqich o‘tish (SSV, 2025–2026 nashrlari)",
    },
    url: "https://anhor.uz/news/whats/",
    official: false,
    checked: "2026-11-17",
    keywords: ["рецепт", "электронн", "аптек", "купить", "отпуск", "retsept", "elektron", "dorixona", "sotib"],
    text: {
      ru: "Минздрав поэтапно расширяет перечень лекарств, которые отпускаются только по электронному рецепту; полный переход по стране планируется завершить к концу 2026 года вместе с внедрением медицинского страхования. Электронный рецепт оформляет и подтверждает цифровыми методами лечащий врач. Аптека не вправе продавать рецептурные препараты без рецепта.",
      uz: "SSV faqat elektron retsept bo‘yicha beriladigan dorilar ro‘yxatini bosqichma-bosqich kengaytirmoqda; mamlakat bo‘yicha to‘liq o‘tish tibbiy sug‘urta bilan birga 2026-yil oxirigacha yakunlanishi rejalashtirilgan. Elektron retseptni davolovchi shifokor rasmiylashtiradi va raqamli usulda tasdiqlaydi. Dorixona retseptli dorilarni retseptsiz sotishga haqli emas.",
    },
  },
];

const APOSTROPHES = /[ʻʼ’‘`´]/g;

export function normalize(s: string): string {
  return s.toLowerCase().replace(APOSTROPHES, "'").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

// Общие слова есть почти в каждом вопросе — они почти не помогают выбрать источник.
const GENERIC = new Set(["бесплатн", "bepul", "государств", "davlat", "врач", "shifokor"]);

/** Простой поиск по ключевым словам: подстрока ключа в нормализованном тексте. */
export function retrieve(query: string, limit = 3): KbEntry[] {
  const q = normalize(query);
  if (!q) return [];
  const scored = KB.map((e) => {
    let score = 0;
    for (const k of e.keywords) {
      const nk = normalize(k);
      if (!q.includes(nk)) continue;
      score += GENERIC.has(nk) ? 0.5 : nk.length >= 5 ? 2 : 1;
    }
    return { e, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.e);
}

export function getEntry(id: string): KbEntry | undefined {
  return KB.find((e) => e.id === id);
}
