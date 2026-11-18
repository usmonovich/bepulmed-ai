// Перечень бесплатных лекарств по программе реимбурсации.
// Источник: приказ министра здравоохранения РУз № 18 от 23.04.2026 (рег. МЮ № 3822 от 24.04.2026),
// «Перечень заболеваний и лекарственных средств, включённых в программу реимбурсации». Действует с 01.01.2027.
// Выдаётся бесплатно по электронному рецепту семейного врача в аптеках с договором ФГМС (Положение — ПКМ № 619 от 02.10.2024).
// Торговые названия — ПРИМЕРЫ для поиска: рецепт выписывается по МНН, конкретный производитель в аптеке может отличаться.

export type MedGroup =
  | "onco"
  | "mental"
  | "gi"
  | "lung"
  | "endo"
  | "diabetes"
  | "cardio"
  | "blood"
  | "parasite"
  | "women"
  | "liver"
  | "cns"
  | "transplant";

export interface FreeMed {
  n: number; // номер в приказе
  group: MedGroup;
  ru: string; // МНН по-русски
  uz: string; // МНН латиницей (узб.)
  forms: string; // форма и дозировка из приказа
  brands?: string[]; // примеры торговых названий
  keys?: string[]; // дополнительные слова для поиска (симптомы, назначение) RU/UZ
  note?: string; // условие из приказа
}

export const GROUPS: Record<MedGroup, { ru: string; uz: string; icon: string; keys: string[] }> = {
  onco: { ru: "Онкологические заболевания", uz: "Onkologik kasalliklar", icon: "🎗️", keys: ["рак", "онкология", "опухоль", "saraton", "onkologiya", "o'sma"] },
  mental: { ru: "Психические расстройства и эпилепсия", uz: "Ruhiy buzilishlar va epilepsiya", icon: "🧠", keys: ["психика", "депрессия", "тревога", "бессонница", "эпилепсия", "судороги", "припадки", "шизофрения", "нервы", "ruhiy", "depressiya", "xavotir", "uyqusizlik", "epilepsiya", "tutqanoq", "asab"] },
  gi: { ru: "Заболевания желудочно-кишечного тракта", uz: "Oshqozon-ichak kasalliklari", icon: "🫃", keys: ["желудок", "изжога", "язва", "гастрит", "кислотность", "oshqozon", "jig'ildon qaynashi", "yara", "gastrit"] },
  lung: { ru: "Хроническая обструктивная болезнь лёгких", uz: "O'pkaning surunkali obstruktiv kasalligi", icon: "🫁", keys: ["лёгкие", "легкие", "одышка", "астма", "хобл", "бронхит", "кашель", "мокрота", "задыхаюсь", "o'pka", "nafas qisishi", "astma", "bronxit", "yo'tal", "balg'am"] },
  endo: { ru: "Эндокринные заболевания", uz: "Endokrin kasalliklar", icon: "🦋", keys: ["гормоны", "эндокринолог", "gormon", "endokrinolog"] },
  diabetes: { ru: "Сахарный диабет", uz: "Qandli diabet", icon: "🩸", keys: ["диабет", "сахар", "сахарный", "высокий сахар", "глюкоза", "инсулин", "diabet", "qand", "qandli", "shakar", "glyukoza", "insulin"] },
  cardio: { ru: "Сердечно-сосудистые заболевания", uz: "Yurak-qon tomir kasalliklari", icon: "❤️", keys: ["сердце", "давление", "гипертония", "высокое давление", "стенокардия", "инфаркт", "инсульт", "аритмия", "холестерин", "отёки", "отеки", "тромбы", "yurak", "qon bosimi", "bosim", "gipertoniya", "stenokardiya", "infarkt", "insult", "aritmiya", "xolesterin", "shish"] },
  blood: { ru: "Болезни крови", uz: "Qon kasalliklari", icon: "🩸", keys: ["кровь", "анемия", "малокровие", "низкий гемоглобин", "железо", "тромбоз", "свертываемость", "qon", "kamqonlik", "anemiya", "gemoglobin", "temir", "tromboz"] },
  parasite: { ru: "Паразитарные заболевания", uz: "Parazitar kasalliklar", icon: "🪱", keys: ["глисты", "паразиты", "гельминты", "gijja", "parazit"] },
  women: { ru: "Возрастные изменения репродуктивной системы женщин", uz: "Ayollar reproduktiv tizimidagi yoshga oid o'zgarishlar", icon: "♀️", keys: ["климакс", "менопауза", "гормоны", "женские", "klimaks", "menopauza", "ayollar"] },
  liver: { ru: "Хронические заболевания печени", uz: "Jigarning surunkali kasalliklari", icon: "🟤", keys: ["печень", "желчь", "желчный", "гепатит", "jigar", "o't", "o't pufagi", "gepatit"] },
  cns: { ru: "Дегенеративные заболевания ЦНС", uz: "MNTning degenerativ kasalliklari", icon: "🧬", keys: ["панэнцефалит", "panensefalit"] },
  transplant: { ru: "Хроническая почечная и печёночная недостаточность (трансплантация)", uz: "Surunkali buyrak va jigar yetishmovchiligi (transplantatsiya)", icon: "🫘", keys: ["пересадка", "трансплантация", "почка", "почки", "почечная недостаточность", "buyrak", "transplantatsiya", "ko'chirib o'tkazish"] },
};

export const FREE_MEDS: FreeMed[] = [
  // Глава 1. Онкологические заболевания
  { n: 1, group: "onco", ru: "Тамоксифен", uz: "Tamoksifen", forms: "таблетки 10 мг; 20 мг", brands: ["Тамоксифен"], keys: ["рак груди", "молочная железа", "ko'krak saratoni"] },
  { n: 2, group: "onco", ru: "Морфина гидрохлорид", uz: "Morfin gidroxlorid", forms: "раствор для инъекций 1% 1 мл", brands: ["Морфин"] , keys: ["сильная боль", "обезболивающее", "kuchli og'riq", "og'riq qoldiruvchi"] },
  { n: 3, group: "onco", ru: "Омнопон", uz: "Omnopon", forms: "раствор для инъекций 1% 1 мл; 2% 1 мл" , keys: ["сильная боль", "обезболивающее", "kuchli og'riq", "og'riq qoldiruvchi"] },
  { n: 4, group: "onco", ru: "Тримеперидин", uz: "Trimeperidin", forms: "раствор для инъекций 1% 1 мл; 2% 1 мл", brands: ["Промедол"] , keys: ["сильная боль", "обезболивающее", "kuchli og'riq", "og'riq qoldiruvchi"] },
  { n: 5, group: "onco", ru: "Трамадол", uz: "Tramadol", forms: "раствор для инъекций 5% 2 мл; капсулы 50 мг", brands: ["Трамал", "Трамадол"] , keys: ["сильная боль", "обезболивающее", "kuchli og'riq", "og'riq qoldiruvchi"] },
  { n: 6, group: "onco", ru: "Налбуфин", uz: "Nalbufin", forms: "раствор для инъекций 10 мг/1 мл" , keys: ["сильная боль", "обезболивающее", "kuchli og'riq", "og'riq qoldiruvchi"] },
  // Глава 2. Психические расстройства
  { n: 7, group: "mental", ru: "Ламотриджин", uz: "Lamotridjin", forms: "таблетки", brands: ["Ламиктал", "Ламитор"], keys: ["эпилепсия", "epilepsiya"] },
  { n: 8, group: "mental", ru: "Карбамазепин", uz: "Karbamazepin", forms: "таблетки", brands: ["Финлепсин", "Тегретол"], keys: ["эпилепсия", "невралгия", "epilepsiya"] },
  { n: 9, group: "mental", ru: "Бензобарбитал", uz: "Benzobarbital", forms: "таблетки", brands: ["Бензонал"], keys: ["эпилепсия", "epilepsiya"] },
  { n: 10, group: "mental", ru: "Вальпроевая кислота", uz: "Valproat kislotasi", forms: "таблетки; капсулы; сироп; капли; детский сироп; раствор для инъекций", brands: ["Депакин", "Конвулекс"], keys: ["эпилепсия", "судороги у ребёнка", "epilepsiya", "bola tutqanoq"] },
  { n: 11, group: "mental", ru: "Клоназепам", uz: "Klonazepam", forms: "таблетки 2 мг", brands: ["Ривотрил"] },
  { n: 12, group: "mental", ru: "Арипипразол", uz: "Aripiprazol", forms: "таблетки", brands: ["Абилифай"] },
  { n: 13, group: "mental", ru: "Галоперидол", uz: "Galoperidol", forms: "таблетки; раствор для инъекций" },
  { n: 14, group: "mental", ru: "Кветиапин", uz: "Ketiapin", forms: "таблетки", brands: ["Сероквель", "Кетилепт"] },
  { n: 15, group: "mental", ru: "Клозапин", uz: "Klozapin", forms: "таблетки", brands: ["Азалептин", "Лепонекс"] },
  { n: 16, group: "mental", ru: "Оланзапин", uz: "Olanzapin", forms: "таблетки", brands: ["Зипрекса"] },
  { n: 17, group: "mental", ru: "Флуфеназина деканоат", uz: "Flufenazin dekanoat", forms: "раствор для инъекций", brands: ["Модитен депо"] },
  { n: 18, group: "mental", ru: "Хлорпромазин", uz: "Xlorpromazin", forms: "таблетки; раствор для инъекций", brands: ["Аминазин"] },
  { n: 19, group: "mental", ru: "Рисперидон", uz: "Risperidon", forms: "таблетки", brands: ["Рисполепт", "Рисперидон"] },
  { n: 20, group: "mental", ru: "Тиоридазин", uz: "Tioridazin", forms: "таблетки", brands: ["Сонапакс"] },
  { n: 21, group: "mental", ru: "Трифлуоперазин", uz: "Triftorperazin", forms: "таблетки; раствор для инъекций", brands: ["Трифтазин"] },
  { n: 22, group: "mental", ru: "Амитриптилин", uz: "Amitriptilin", forms: "таблетки; раствор для инъекций", keys: ["депрессия", "depressiya"] },
  { n: 23, group: "mental", ru: "Венлафаксин", uz: "Venlafaksin", forms: "таблетки 37,5 мг; капсулы", brands: ["Велаксин", "Велафакс"], keys: ["депрессия", "depressiya"] },
  { n: 24, group: "mental", ru: "Пароксетин", uz: "Paroksetin", forms: "таблетки 20 мг", brands: ["Паксил", "Рексетин"], keys: ["депрессия", "тревога", "паника", "depressiya", "vahima"] },
  { n: 25, group: "mental", ru: "Сертралин", uz: "Sertralin", forms: "таблетки 50 мг", brands: ["Золофт", "Стимулотон", "Асентра"], keys: ["депрессия", "тревога", "depressiya"] },
  { n: 26, group: "mental", ru: "Тразодон", uz: "Trazodon", forms: "таблетки 150 мг", brands: ["Триттико"], keys: ["бессонница", "депрессия", "uyqusizlik"] },
  { n: 27, group: "mental", ru: "Миртазапин", uz: "Mirtazapin", forms: "таблетки 30 мг", brands: ["Ремерон", "Миртазонал"], keys: ["депрессия", "бессонница", "depressiya"] },
  { n: 28, group: "mental", ru: "Эсциталопрам", uz: "Essitalopram", forms: "таблетки 10 мг", brands: ["Ципралекс", "Селектра"], keys: ["депрессия", "тревога", "depressiya", "xavotir"] },
  // Глава 3. ЖКТ
  { n: 29, group: "gi", ru: "Омепразол", uz: "Omeprazol", forms: "таблетки 20 мг; 40 мг", brands: ["Омез", "Омепразол", "Ультоп"], keys: ["изжога", "язва желудка", "гастрит", "рефлюкс", "jig'ildon qaynashi", "oshqozon yarasi"] },
  // Глава 4. ХОБЛ
  { n: 30, group: "lung", ru: "Сальбутамол", uz: "Salbutamol", forms: "аэрозоль 100 мкг/доза, 200 доз", brands: ["Вентолин", "Сальбутамол"], keys: ["ингалятор", "приступ удушья", "астма", "ingalyator", "nafas qisishi", "astma"] },
  { n: 31, group: "lung", ru: "Амброксол", uz: "Ambroksol", forms: "таблетки 30 мг", brands: ["Лазолван", "Амбробене"], keys: ["мокрота", "кашель с мокротой", "отхаркивающее", "balg'am", "yo'tal"] },
  // Глава 5. Эндокринные заболевания
  { n: 32, group: "endo", ru: "Калия йодид", uz: "Kaliy yodid", forms: "таблетки 200 мкг", brands: ["Йодомарин", "Йодбаланс"], keys: ["щитовидка", "щитовидная железа", "qalqonsimon bez", "зоб", "buqoq", "йод", "недостаток йода", "yod"] },
  { n: 33, group: "endo", ru: "Тиамазол", uz: "Tiamazol", forms: "таблетки 5 мг", brands: ["Тирозол", "Мерказолил"], keys: ["щитовидка", "щитовидная железа", "qalqonsimon bez", "гипертиреоз", "тиреотоксикоз", "повышенная функция щитовидки", "gipertireoz"] },
  { n: 34, group: "endo", ru: "Левотироксин натрия", uz: "Levotiroksin natriy", forms: "таблетки 100 мкг", brands: ["Эутирокс", "L-тироксин"], keys: ["щитовидка", "щитовидная железа", "qalqonsimon bez", "гипотиреоз", "пониженная функция щитовидки", "gipotireoz"] },
  { n: 35, group: "diabetes", ru: "Инсулин короткого действия", uz: "Qisqa ta'sirli insulin", forms: "раствор для инъекций 100 ЕД/10 мл", brands: ["Актрапид", "Хумулин Регуляр"] , keys: ["сахар", "сахарный диабет", "qand", "qandli diabet"] },
  { n: 36, group: "diabetes", ru: "Аналог инсулина короткого действия", uz: "Qisqa ta'sirli insulin analogi", forms: "раствор для инъекций 100 ЕД/3 мл", brands: ["НовоРапид", "Хумалог", "Апидра"] , keys: ["сахар", "сахарный диабет", "qand", "qandli diabet"] },
  { n: 37, group: "diabetes", ru: "Инсулин длительного действия", uz: "Uzoq ta'sirli insulin", forms: "раствор для инъекций 100 ЕД/10 мл; картридж и шприц-ручка", brands: ["Протафан", "Хумулин НПХ"], note: "Картриджи и шприц-ручки — детям до 15 лет с сахарным диабетом 1 типа" , keys: ["сахар", "сахарный диабет", "qand", "qandli diabet"] },
  { n: 38, group: "diabetes", ru: "Аналог инсулина длительного действия", uz: "Uzoq ta'sirli insulin analogi", forms: "раствор для инъекций 100 ЕД/3 мл; картридж и шприц-ручка", brands: ["Лантус", "Левемир", "Тресиба", "Туджео"], note: "Картриджи и шприц-ручки — детям до 15 лет с сахарным диабетом 1 типа" , keys: ["сахар", "сахарный диабет", "qand", "qandli diabet"] },
  { n: 39, group: "diabetes", ru: "Инсулин смешанного действия", uz: "Aralash ta'sirli insulin", forms: "раствор для инъекций 100 ЕД/10 мл; картридж и шприц-ручка", brands: ["Микстард 30", "Хумулин М3"], note: "Картриджи и шприц-ручки — детям до 15 лет с сахарным диабетом 1 типа" , keys: ["сахар", "сахарный диабет", "qand", "qandli diabet"] },
  { n: 40, group: "diabetes", ru: "Гликлазид", uz: "Gliklazid", forms: "таблетки 30 мг; 60 мг", brands: ["Диабетон МВ", "Гликлазид"], keys: ["сахар", "сахарный диабет", "qand", "qandli diabet", "диабет 2 типа", "2-tip diabet"] },
  { n: 41, group: "diabetes", ru: "Метформин", uz: "Metformin", forms: "таблетки 500 мг; 1000 мг", brands: ["Глюкофаж", "Сиофор", "Метформин"], keys: ["сахар", "сахарный диабет", "qand", "qandli diabet", "диабет 2 типа", "лишний вес", "2-tip diabet"] },
  { n: 42, group: "diabetes", ru: "Эмпаглифлозин", uz: "Empagliflozin", forms: "таблетки 10 мг; 25 мг", brands: ["Джардинс"], keys: ["сахар", "сахарный диабет", "qand", "qandli diabet", "диабет 2 типа", "сердечная недостаточность", "2-tip diabet"] },
  { n: 43, group: "endo", ru: "Десмопрессин", uz: "Desmopressin", forms: "капли назальные 100 мкг/мл 5 мл; спрей назальный 10 мкг/доза 5 мл", brands: ["Минирин", "Пресайнекс"], keys: ["несахарный диабет", "ночное недержание", "энурез", "сильная жажда", "qandsiz diabet", "enurez"] },
  { n: 44, group: "endo", ru: "Гидрокортизон", uz: "Gidrokortizon", forms: "глазная мазь 0,5%, 1%, 2,5%; мазь 0,1%; глазная суспензия 0,1%", keys: ["мазь", "воспаление глаз", "кожа", "надпочечники", "malham", "ko'z yallig'lanishi", "teri"] },
  { n: 45, group: "endo", ru: "Преднизолон", uz: "Prednizolon", forms: "таблетки 5 мг", keys: ["гормон", "воспаление", "надпочечники", "gormon", "yallig'lanish"] },
  // Глава 6. Сердечно-сосудистые заболевания
  { n: 46, group: "cardio", ru: "Верапамил", uz: "Verapamil", forms: "таблетки", brands: ["Изоптин", "Верапамил"], keys: ["аритмия", "тахикардия", "давление", "aritmiya", "taxikardiya"] },
  { n: 47, group: "cardio", ru: "Изосорбида мононитрат", uz: "Izosorbid mononitrat", forms: "таблетки 20 мг; 40 мг", brands: ["Моночинкве", "Эфокс", "Мономак"], keys: ["стенокардия", "боль в сердце", "stenokardiya", "yurak og'rig'i"] },
  { n: 48, group: "cardio", ru: "Изосорбида динитрат", uz: "Izosorbid dinitrat", forms: "спрей; таблетки", brands: ["Изокет", "Кардикет"], keys: ["стенокардия", "приступ", "боль в груди", "stenokardiya"] },
  { n: 49, group: "cardio", ru: "Ацетилсалициловая кислота", uz: "Atsetilsalitsil kislotasi", forms: "таблетки 75 мг; 150 мг", brands: ["Аспирин Кардио", "Кардиомагнил", "Тромбо АСС"], keys: ["аспирин", "разжижение крови", "профилактика инфаркта", "тромбы", "aspirin", "qonni suyultirish"] },
  { n: 50, group: "cardio", ru: "Клопидогрел", uz: "Klopidogrel", forms: "таблетки 75 мг", brands: ["Плавикс", "Зилт", "Клопидогрел"], keys: ["после инфаркта", "стент", "тромбы", "infarktdan keyin", "stent"] },
  { n: 51, group: "cardio", ru: "Бисопролол", uz: "Bisoprolol", forms: "таблетки 2,5 мг; 5 мг; 10 мг", brands: ["Конкор", "Бисопролол", "Бипрол"], keys: ["давление", "пульс", "тахикардия", "сердечная недостаточность", "bosim", "puls"] },
  { n: 52, group: "cardio", ru: "Амлодипин", uz: "Amlodipin", forms: "таблетки 2,5 мг; 5 мг; 10 мг", brands: ["Норваск", "Нормодипин", "Амлодипин", "Тенокс"], keys: ["давление", "гипертония", "bosim", "gipertoniya"] },
  { n: 53, group: "cardio", ru: "Эналаприл", uz: "Enalapril", forms: "таблетки 2,5 мг; 5 мг; 10 мг; 20 мг", brands: ["Энап", "Ренитек", "Эналаприл", "Берлиприл"], keys: ["давление", "гипертония", "bosim", "gipertoniya"] },
  { n: 54, group: "cardio", ru: "Аторвастатин", uz: "Atorvastatin", forms: "таблетки 10 мг; 20 мг; 40 мг; 80 мг", brands: ["Аторис", "Липримар", "Торвакард", "Аторвастатин"], keys: ["холестерин", "атеросклероз", "xolesterin", "ateroskleroz"] },
  { n: 55, group: "cardio", ru: "Спиронолактон", uz: "Spironolakton", forms: "таблетки 25 мг", brands: ["Верошпирон"], keys: ["мочегонное", "отёки", "отеки", "siydik haydovchi", "shish"] },
  { n: 56, group: "cardio", ru: "Фуросемид", uz: "Furosemid", forms: "таблетки 40 мг; раствор для инъекций 1% 2 мл", brands: ["Лазикс", "Фуросемид"], keys: ["мочегонное", "отёки", "отеки", "siydik haydovchi", "shish"] },
  // Глава 7. Болезни крови
  { n: 57, group: "blood", ru: "Гепарин", uz: "Geparin", forms: "раствор для инъекций 5 000 ЕД; 12 500 ЕД; 25 000 ЕД", keys: ["тромбоз", "свёртываемость", "tromboz"] },
  { n: 58, group: "blood", ru: "Варфарин", uz: "Varfarin", forms: "таблетки 2,5 мг", keys: ["тромбоз", "мерцательная аритмия", "клапан", "разжижение крови", "tromboz", "qonni suyultirish"] },
  { n: 59, group: "blood", ru: "Соединения железа (II)", uz: "Temir (II) birikmalari", forms: "таблетки 100 мг; капсулы 100 мг", brands: ["Сорбифер Дурулес", "Тардиферон", "Феррофольгамма"], keys: ["железо", "анемия", "малокровие", "низкий гемоглобин", "temir", "kamqonlik"] },
  { n: 60, group: "blood", ru: "Соединения железа (III)", uz: "Temir (III) birikmalari", forms: "таблетки 100 мг; капсулы 100 мг", brands: ["Мальтофер", "Феррум Лек"], keys: ["железо", "анемия", "малокровие", "низкий гемоглобин", "беременность", "temir", "kamqonlik", "homiladorlik"] },
  { n: 61, group: "blood", ru: "Фолиевая кислота", uz: "Foliy kislotasi", forms: "таблетки 1 мг; 5 мг", keys: ["анемия", "беременность", "витамин B9", "kamqonlik", "homiladorlik", "vitamin"] },
  // Глава 8. Паразитарные заболевания
  { n: 62, group: "parasite", ru: "Альбендазол", uz: "Albendazol", forms: "таблетки; суспензия", brands: ["Немозол", "Альдазол"], keys: ["глисты", "gijja"] },
  // Глава 9. Возрастные изменения у женщин
  { n: 63, group: "women", ru: "Дроспиренон + этинилэстрадиол", uz: "Drospirenon + etinilestradiol", forms: "таблетки", brands: ["Ярина", "Джес", "Мидиана"] },
  // Глава 10. Хронические заболевания печени
  { n: 64, group: "liver", ru: "Урсодезоксихолевая кислота", uz: "Ursodezoksixol kislotasi", forms: "капсулы 250 мг", brands: ["Урсосан", "Урсофальк", "Урсолив"], keys: ["желчные камни", "застой желчи", "o't tosh"] },
  // Глава 11. Дегенеративные заболевания ЦНС
  { n: 65, group: "cns", ru: "Инозин пранобекс", uz: "Inozin pranobeks", forms: "таблетки 500 мг", brands: ["Изопринозин", "Гроприносин"], note: "Только при подостром склерозирующем панэнцефалите (МКБ A81.1)" },
  // Глава 12. Хроническая почечная и печёночная недостаточность
  { n: 66, group: "transplant", ru: "Циклоспорин", uz: "Siklosporin", forms: "капсулы 25 мг; 50 мг; 100 мг", brands: ["Сандиммун Неорал"] },
  { n: 67, group: "transplant", ru: "Такролимус", uz: "Takrolimus", forms: "капсулы 0,5 мг; 1 мг; 5 мг", brands: ["Програф", "Адваграф"] },
  { n: 68, group: "transplant", ru: "Микофенолата мофетил", uz: "Mikofenolat mofetil", forms: "таблетки 250 мг; 500 мг; капсулы 250 мг; 500 мг", brands: ["СеллСепт"] },
  { n: 69, group: "transplant", ru: "Микофеноловая кислота", uz: "Mikofenol kislotasi", forms: "таблетки 180 мг; 360 мг", brands: ["Майфортик"] },
];

export const MEDS_SOURCE = {
  title: "Приказ МЗ РУз № 18 от 23.04.2026 (рег. № 3822): перечень реимбурсации, действует с 01.01.2027",
  url: "https://yep.uz/wp-content/uploads/2026/04/uzbekistan-vozmeschenie-2026-2027.pdf",
};
