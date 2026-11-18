// Справочник государственных медучреждений Ташкента (встроен в приложение, работает без интернета).
// Источники (проверено 18.11.2026):
//  • gov.uz / advice.uz — «Специализированные медицинские центры и институты» (адреса, телефоны, сайты);
//  • каталоги goldenpages.uz и yellowpages.uz — семейные и центральные многопрофильные поликлиники по районам
//    (телефоны там скрыты, поэтому для поликлиник указан только адрес).
// Адреса могут меняться — перед визитом уточняйте по телефону 1003 (горячая линия Минздрава) или в поликлинике.

export type District =
  | "olmazor" | "bektemir" | "mirobod" | "mirzo" | "sergeli" | "uchtepa" | "chilonzor" | "shayxontohur" | "yunusobod" | "yakkasaroy" | "yashnobod" | "yangihayot" | "region";

export const DISTRICTS: Record<District, { ru: string; uz: string; lat: number; lon: number }> = {
  // Ориентировочные центры районов — только чтобы предложить «ваш район» по геолокации.
  olmazor: { ru: "Алмазарский", uz: "Olmazor", lat: 41.352, lon: 69.214 },
  bektemir: { ru: "Бектемирский", uz: "Bektemir", lat: 41.214, lon: 69.334 },
  mirobod: { ru: "Мирабадский", uz: "Mirobod", lat: 41.288, lon: 69.283 },
  mirzo: { ru: "Мирзо-Улугбекский", uz: "Mirzo Ulug‘bek", lat: 41.338, lon: 69.336 },
  sergeli: { ru: "Сергелийский", uz: "Sergeli", lat: 41.226, lon: 69.224 },
  uchtepa: { ru: "Учтепинский", uz: "Uchtepa", lat: 41.297, lon: 69.172 },
  chilonzor: { ru: "Чиланзарский", uz: "Chilonzor", lat: 41.276, lon: 69.203 },
  shayxontohur: { ru: "Шайхантахурский", uz: "Shayxontohur", lat: 41.326, lon: 69.238 },
  yunusobod: { ru: "Юнусабадский", uz: "Yunusobod", lat: 41.366, lon: 69.287 },
  yakkasaroy: { ru: "Яккасарайский", uz: "Yakkasaroy", lat: 41.287, lon: 69.255 },
  yashnobod: { ru: "Яшнабадский", uz: "Yashnobod", lat: 41.302, lon: 69.338 },
  yangihayot: { ru: "Янгихаётский", uz: "Yangihayot", lat: 41.205, lon: 69.205 },
  region: { ru: "Ташкентская область", uz: "Toshkent viloyati", lat: 41.36, lon: 69.4 },
};

export type FacilityType = "family" | "central" | "specialized" | "emergency" | "other";

export interface TkFacility {
  id: string;
  type: FacilityType;
  district: District | null;
  ru: string;
  uz: string;
  address: string;
  phones?: string[];
  website?: string;
  keys?: string[]; // профиль для поиска: «сердце», «yurak»…
  src: "gov" | "gp" | "yp";
}

const SRC_URL = {
  gov: "https://gov.uz/en/advice/63/document/2185",
  gp: "https://www.goldenpages.uz/rubrics/?Id=107503",
  yp: "https://www.yellowpages.uz/uz/rubrika/poliklinikalar/toshkent",
};
export const sourceUrl = (f: TkFacility) => SRC_URL[f.src];

// Семейные поликлиники: [номер, район, адрес, источник]
const FAMILY: [string, District, string, "gp" | "yp"][] = [
  ["1 при РКБ №2", "mirzo", "пос. Улугбек, 1-й пр. Булаксой, 1", "gp"],
  ["1", "mirobod", "ул. Фидокор, 6", "yp"],
  ["2", "mirobod", "м-в Куйлюк-3, 29А", "yp"],
  ["3", "mirobod", "ул. Хамал, 31", "yp"],
  ["4", "mirzo", "ул. Каландар, 2", "gp"],
  ["5", "mirzo", "пр. Мустакиллик, м-в Буюк Ипак Йули, 22", "gp"],
  ["6", "mirzo", "ул. Ахиллик, 10 (м-в ТТЗ-2)", "gp"],
  ["7", "mirzo", "ул. Шахриабад, 218", "gp"],
  ["8", "mirzo", "ул. Мингбулак, 40", "gp"],
  ["9", "mirzo", "ул. Геологическая, 26", "gp"],
  ["10", "sergeli", "ул. Шокирарик, 18Д", "yp"],
  ["11", "sergeli", "ул. Чоштепа, 147Б", "yp"],
  ["11 (филиал)", "sergeli", "ул. Нугойкургон, 26", "yp"],
  ["12", "sergeli", "м-в Куйлюк-5, 46", "yp"],
  ["14", "olmazor", "ул. Сагбан, 1", "gp"],
  ["15", "olmazor", "ул. 2-я Каракамышская, 1", "gp"],
  ["16", "olmazor", "2-й пр. Шифокорлар, 6", "gp"],
  ["17", "olmazor", "ул. Сагбан, 225", "gp"],
  ["18", "olmazor", "ул. Мирзо Галиба, 2Г", "gp"],
  ["19", "olmazor", "ул. Себзар, 271А", "gp"],
  ["19 (филиал «Кумок»)", "olmazor", "ул. Заркайнар, 178", "gp"],
  ["20", "olmazor", "м-в Каракамыш-1/2, 2В", "gp"],
  ["21", "olmazor", "ул. Келес йули, 169", "gp"],
  ["21 (филиал)", "olmazor", "ул. 4-я Каракамышская, 10", "gp"],
  ["22", "uchtepa", "ул. Бешкайрагач, 237", "yp"],
  ["23", "uchtepa", "ул. Юсуф Саккокий, 4А", "yp"],
  ["23 (филиал «Бирлик»)", "uchtepa", "ул. Чакмоний, 14А", "yp"],
  ["24", "uchtepa", "м-в Чиланзар-11, 1Б", "yp"],
  ["25", "uchtepa", "м-в Чиланзар-14, 5", "yp"],
  ["26", "uchtepa", "ул. Мергенча, 14А", "yp"],
  ["27", "yashnobod", "ул. Джаркурганская, 37А", "gp"],
  ["28", "yashnobod", "4-й пр. Таларык, 2", "gp"],
  ["29", "yashnobod", "ул. Фаргона йули, м-в Куйлюк Ц-2, 543", "gp"],
  ["30", "yashnobod", "ул. Бирлашган, 8", "gp"],
  ["31", "yashnobod", "м-в Тузель-1, 40А", "gp"],
  ["32", "yashnobod", "ул. Ошская, 26", "gp"],
  ["33", "chilonzor", "ул. Кичик халка йули, 7", "yp"],
  ["33 (филиал)", "chilonzor", "ул. Тирсакобод, 7", "yp"],
  ["34", "chilonzor", "м-в Чиланзар-2, 2Б", "yp"],
  ["35", "chilonzor", "м-в Чиланзар-20, 4А", "yp"],
  ["36", "chilonzor", "ул. Мукимий, 142", "yp"],
  ["37", "chilonzor", "1-й пр. Катартал, 1", "yp"],
  ["38", "chilonzor", "м-в Аль-Хорезми, 17", "yp"],
  ["39", "chilonzor", "ул. Наккошлик, 7А", "yp"],
  ["40", "shayxontohur", "м-в Ибн Сино-1", "yp"],
  ["41", "shayxontohur", "ул. Ипакчи, 73А", "yp"],
  ["42", "shayxontohur", "ул. Тахтапуль, 14А", "yp"],
  ["43", "shayxontohur", "ул. Чукуркуприк, 12", "yp"],
  ["44", "shayxontohur", "ул. Богкуча, 13А", "yp"],
  ["45", "shayxontohur", "ул. Хувайдо, 45", "yp"],
  ["46", "shayxontohur", "ул. Самарканд-Дарвоза, 198", "yp"],
  ["47", "shayxontohur", "ул. Фуркат, 10А", "yp"],
  ["48", "shayxontohur", "ул. Абая, 5", "yp"],
  ["49", "yunusobod", "ул. Чинабад, 88Б", "gp"],
  ["49 (филиал)", "yunusobod", "ул. Чинабад, 181", "gp"],
  ["50", "yunusobod", "м-в Минор, 120", "gp"],
  ["51", "yunusobod", "пр. Амира Темура, 117Б", "gp"],
  ["52", "yunusobod", "кв. Юнусабад-7, 28А", "gp"],
  ["53", "yunusobod", "м-в Кашгар, ул. А. Кадыри, 24А", "gp"],
  ["54", "yunusobod", "кв. Юнусабад-3", "gp"],
  ["55", "yunusobod", "кв. Юнусабад-17, 22А", "gp"],
  ["56", "yunusobod", "2-й пр. Козитарнов, 9", "gp"],
  ["63", "olmazor", "м-в Бешкурган-2, 10А", "gp"],
  ["64", "yunusobod", "ул. Ходжаабад, 46", "gp"],
];

// Центральные многопрофильные (районные) поликлиники и прочие государственные поликлиники
const CENTRAL: [string, string, District, string, "gp" | "yp"][] = [
  ["Центральная многопрофильная поликлиника Алмазарского района", "Olmazor tumani markaziy ko‘p tarmoqli poliklinikasi", "olmazor", "ул. Себзар, м-в Себзар, 19", "gp"],
  ["Центральная многопрофильная поликлиника Бектемирского района", "Bektemir tumani markaziy ko‘p tarmoqli poliklinikasi", "bektemir", "м-в Сувсоз-2, 75", "gp"],
  ["Центральная поликлиника Мирабадского района", "Mirobod tumani markaziy poliklinikasi", "mirobod", "Мирабадский район (адрес уточняйте по 1003)", "yp"],
  ["Центральная диагностическая поликлиника Мирзо-Улугбекского района", "Mirzo Ulug‘bek tumani markaziy diagnostika poliklinikasi", "mirzo", "м-в ТТЗ-2, ул. Ахиллик, 2", "gp"],
  ["Центральная поликлиника Сергелийского района (филиал №2)", "Sergeli tumani markaziy poliklinikasi (2-filial)", "sergeli", "м-в Сергели-2, 31А", "yp"],
  ["Центральная многопрофильная поликлиника Янгихаётского района", "Yangihayot tumani markaziy ko‘p tarmoqli poliklinikasi", "yangihayot", "м-в Йулдош-5, 24", "gp"],
  ["Центральная поликлиника Учтепинского района", "Uchtepa tumani markaziy poliklinikasi", "uchtepa", "м-в Чиланзар-25, 47", "yp"],
  ["Центральная поликлиника Чиланзарского района", "Chilonzor tumani markaziy poliklinikasi", "chilonzor", "пр. Бунёдкор, 7А", "yp"],
  ["Центральная поликлиника Шайхантахурского района", "Shayxontohur tumani markaziy poliklinikasi", "shayxontohur", "ул. Маннон Уйгур, 305", "yp"],
  ["Центральная многопрофильная поликлиника Юнусабадского района", "Yunusobod tumani markaziy ko‘p tarmoqli poliklinikasi", "yunusobod", "кв. Юнусабад-19, ул. Юнус-Ота, 2", "gp"],
  ["Медобъединение Яккасарайского района — многопрофильная центральная поликлиника со стационаром", "Yakkasaroy tuman tibbiyot birlashmasi — ko‘p tarmoqli markaziy poliklinika", "yakkasaroy", "ул. Шота Руставели, 84", "yp"],
  ["Яшнабадская централизованная многопрофильная поликлиника", "Yashnobod tumani markaziy ko‘p tarmoqli poliklinikasi", "yashnobod", "пр. Махтумкули, 2", "gp"],
  ["Центральная клинико-диагностическая поликлиника Минздрава", "SSV markaziy klinik-diagnostika poliklinikasi", "yashnobod", "ул. Карасу, 25", "gp"],
  ["Студенческая поликлиника №32", "32-son talabalar poliklinikasi", "olmazor", "м-в Вузгородок, 95", "gp"],
];

// Республиканские специализированные центры (gov.uz). [ru, uz, район|null, адрес, телефоны, сайт, ключи поиска]
const SPECIAL: [string, string, District | null, string, string[], string | undefined, string[], FacilityType?][] = [
  ["Республиканский научный центр экстренной медицинской помощи", "Respublika shoshilinch tibbiy yordam ilmiy markazi", null, "ул. Кичик халка йули, 2", ["+998 78 150-46-00"], "https://www.emerge-centre.uz/", ["экстренная", "травма", "скорая", "реанимация", "shoshilinch", "jarohat", "travma"], "emergency"],
  ["РСНПМЦ кардиологии", "Respublika ixtisoslashtirilgan kardiologiya markazi", "mirzo", "ул. Осие, 4", ["+998 71 237-31-57"], "https://cardiocenter.uz", ["сердце", "кардиолог", "давление", "инфаркт", "yurak", "kardiolog", "bosim"]],
  ["РСНПМЦ эндокринологии", "Respublika ixtisoslashtirilgan endokrinologiya markazi", "mirzo", "пр. Мирзо Улугбека, 56", ["+998 71 262-27-02", "+998 71 262-25-53"], undefined, ["диабет", "сахар", "щитовидка", "эндокринолог", "diabet", "qand", "qalqonsimon", "endokrinolog"]],
  ["Республиканский научно-практический медицинский центр онкологии и радиологии", "Respublika onkologiya va radiologiya markazi", "shayxontohur", "ул. Фароби, 383", ["+998 71 246-05-13", "+998 71 227-13-27"], "http://cancercenter.uz", ["рак", "онколог", "опухоль", "saraton", "onkolog", "o'sma"]],
  ["РСНПМЦ нефрологии и трансплантации почки", "Respublika nefrologiya va buyrak transplantatsiyasi markazi", "yunusobod", "кв. Юнусабад-3, ул. Янги шахар, 9", ["+998 71 224-96-59"], "https://nefro.uz", ["почки", "нефролог", "диализ", "пересадка", "buyrak", "nefrolog", "dializ"]],
  ["Республиканский специализированный центр урологии", "Respublika ixtisoslashtirilgan urologiya markazi", null, "ул. Шифокорлар, 1", ["+998 78 150-65-83", "+998 78 150-65-71"], "http://www.rscu.uz", ["уролог", "почки", "мочевой", "простата", "urolog", "siydik"]],
  ["Республиканский научный центр нейрохирургии", "Respublika neyroxirurgiya ilmiy markazi", "mirzo", "м-в Хумоюн, 40", ["+998 71 264-96-10", "+998 71 264-96-09"], undefined, ["нейрохирург", "позвоночник", "головной мозг", "грыжа", "neyroxirurg", "umurtqa", "miya"]],
  ["Республиканский специализированный центр хирургической ангионеврологии", "Respublika xirurgik angionevrologiya markazi", null, "ул. Фараби, 2", ["+998 78 150-92-12"], "https://angioneurology.uz", ["инсульт", "сосуды", "невролог", "insult", "tomir", "nevrolog"]],
  ["РСНПМЦ терапии и медицинской реабилитации", "Respublika terapiya va tibbiy reabilitatsiya markazi", "yunusobod", "ул. Хуршида, 4", ["+998 71 234-33-21", "+998 71 234-69-14"], "http://www.therapy.uz", ["терапевт", "реабилитация", "terapevt", "reabilitatsiya"]],
  ["РСНПМЦ фтизиатрии и пульмонологии", "Respublika ftiziatriya va pulmonologiya markazi", "shayxontohur", "ул. Алимова, 1", ["+998 71 278-04-70", "+998 71 278-15-28"], "http://www.tbcenter.uz", ["туберкулёз", "туберкулез", "лёгкие", "легкие", "пульмонолог", "sil", "o'pka", "pulmonolog"]],
  ["РСНПМЦ акушерства и гинекологии", "Respublika akusherlik va ginekologiya markazi", "mirzo", "ул. Мирзо Улугбека, 132А", ["+998 71 263-78-33"], "http://www.akusherstvo.uz", ["беременность", "роды", "гинеколог", "homiladorlik", "tug'ruq", "ginekolog"]],
  ["Республиканский перинатальный центр", "Respublika perinatal markazi", null, "ул. Дж. Абидовой, 223 (клиника ТашПМИ)", ["+998 71 260-28-80"], undefined, ["роды", "новорождённый", "беременность", "tug'ruq", "chaqaloq"]],
  ["Республиканский центр скрининга матери и ребёнка", "Respublika ona va bola skrining markazi", "yunusobod", "ул. Багишамол, 5-й проезд, 3", ["+998 71 260-28-46"], undefined, ["скрининг", "беременность", "ребёнок", "skrining", "bola"]],
  ["Республиканская детская психоневрологическая больница", "Respublika bolalar psixonevrologiya shifoxonasi", "mirzo", "ул. Олмачи, 1", ["+998 71 267-73-57", "+998 71 267-73-50"], "http://www.rdpnb.uz", ["ребёнок", "детский невролог", "психиатр", "bola", "nevrolog"]],
  ["Республиканская клиническая офтальмологическая больница", "Respublika klinik oftalmologiya shifoxonasi", null, "ул. Зиё, 12", ["+998 71 246-06-30"], undefined, ["глаза", "окулист", "офтальмолог", "ko'z", "oftalmolog"]],
  ["Республиканский специализированный центр микрохирургии глаза", "Respublika ko‘z mikroxirurgiyasi markazi", "uchtepa", "ул. Кичик халка йули, 14", ["+998 71 217-49-34"], undefined, ["глаза", "катаракта", "ko'z", "katarakta"]],
  ["РСМЦ дерматологии и венерологии", "Respublika dermatologiya va venerologiya markazi", "olmazor", "ул. Фароби, 3", ["+998 71 214-50-98"], "http://www.dermatology.uz", ["кожа", "дерматолог", "teri", "dermatolog"]],
  ["НИИ травматологии и ортопедии", "Travmatologiya va ortopediya ilmiy-tadqiqot instituti", null, "ул. Махтумкули, 78", ["+998 71 233-80-04"], "https://www.uzniito.uz", ["перелом", "травма", "ортопед", "суставы", "sinish", "travma", "ortoped"]],
  ["НИИ эпидемиологии, микробиологии и инфекционных заболеваний", "Epidemiologiya, mikrobiologiya va yuqumli kasalliklar ITI", "uchtepa", "ул. Заковат, 2", ["+998 71 243-36-05", "+998 71 243-36-04"], "http://www.infectology.uz", ["инфекция", "инфекционист", "гепатит", "yuqumli", "infeksiya"]],
  ["НИИ гематологии и переливания крови", "Gematologiya va qon quyish ITI", "chilonzor", "Чиланзар-5Б, 42А", ["+998 71 278-94-78"], undefined, ["кровь", "гематолог", "анемия", "qon", "gematolog"]],
  ["НИИ вирусологии (клиника)", "Virusologiya ITI klinikasi", "yunusobod", "Юнусабад-3, ул. Янги шахар, 7А", ["+998 71 224-83-26"], undefined, ["вирус", "гепатит", "virus", "gepatit"]],
  ["Клиника НИИ санитарии, гигиены и профзаболеваний", "Sanitariya, gigiyena va kasb kasalliklari ITI klinikasi", "mirzo", "ул. Олтинтепа, 325", ["+998 71 266-47-36"], undefined, ["профзаболевания", "kasb kasalliklari"]],
  ["Республиканский центр по борьбе со СПИДом", "Respublika OITSga qarshi kurash markazi", null, "ул. Фархад, 12", ["+998 71 276-93-25"], undefined, ["вич", "спид", "oits", "vich"]],
  ["Республиканский научно-практический центр народной медицины", "Respublika xalq tabobati markazi", "mirzo", "ул. Паркентская, 51", ["+998 71 268-08-97"], undefined, ["народная медицина", "xalq tabobati"]],
  ["Институт здоровья и медицинской статистики", "Salomatlik va tibbiy statistika instituti", "mirzo", "пр. Мирзо Улугбека, 38", ["+998 71 267-62-44"], "http://www.med.uz", ["статистика", "statistika"], "other"],
  ["Республиканский детский реабилитационный центр заболеваний опорно-двигательной системы", "Respublika bolalar tayanch-harakat tizimi reabilitatsiya markazi", "region", "Ташкентская обл., Кибрайский р-н, пос. Салар, ул. Бобура, 4", ["+998 71 260-63-30"], "http://www.chrc.uz", ["ребёнок", "реабилитация", "опорно-двигательный", "bola", "reabilitatsiya"]],
];

const famUz = (num: string) => `${num.replace(/\s*\(.*\)/, "").replace(/ при РКБ №2/, "")}-sonli oilaviy poliklinika${/филиал/.test(num) ? " (filial)" : ""}`;

export const TASHKENT_FACILITIES: TkFacility[] = [
  ...SPECIAL.map(([ru, uz, district, address, phones, website, keys, type], i) => ({ id: `s${i + 1}`, type: type ?? "specialized", district, ru, uz, address, phones, website, keys, src: "gov" as const })),
  ...CENTRAL.map(([ru, uz, district, address, src], i) => ({ id: `c${i + 1}`, type: "central" as const, district, ru, uz, address, src, keys: ["районная поликлиника", "узкие специалисты", "tuman poliklinikasi"] })),
  ...FAMILY.map(([num, district, address, src], i) => ({
    id: `f${i + 1}`,
    type: "family" as const,
    district,
    ru: `Семейная поликлиника №${num}`,
    uz: famUz(num),
    address,
    src,
    keys: ["семейный врач", "терапевт", "педиатр", "направление", "рецепт", "прикрепление", "oilaviy shifokor", "terapevt", "pediatr", "yo'llanma", "retsept"],
  })),
];

export const HOTLINE = { phone: "1003", ru: "Телефон доверия Минздрава", uz: "SSV ishonch telefoni" };

/** Ближайший район по координатам (ориентировочно). */
export function nearestDistrict(p: { lat: number; lon: number }): District | null {
  let best: District | null = null;
  let bestD = Infinity;
  for (const [k, d] of Object.entries(DISTRICTS) as [District, (typeof DISTRICTS)[District]][]) {
    if (k === "region") continue;
    const dd = (d.lat - p.lat) ** 2 + ((d.lon - p.lon) * Math.cos((p.lat * Math.PI) / 180)) ** 2;
    if (dd < bestD) {
      bestD = dd;
      best = k;
    }
  }
  // Дальше ~12 км от любого центра района — вне Ташкента.
  return bestD < (12 / 111) ** 2 ? best : null;
}

/** Маршрут по адресу (координат в справочнике нет): открывает поиск в Яндекс.Картах. */
export function addressRouteUrl(f: TkFacility): string {
  const q = `Ташкент, ${f.address.replace(/\s*\(.*?\)/g, "")}, ${f.ru}`;
  return `https://yandex.uz/maps/?text=${encodeURIComponent(q)}`;
}
