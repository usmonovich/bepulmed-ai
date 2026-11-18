import type { Facility } from "../lib/api";

// Учреждения, которые команда ЛИЧНО проверила по официальному источнику
// (сайт учреждения, Минздрав, звонок). Только такие получают значок «Проверено».
// Формат записи:
// {
//   id: "v-1", name: "Семейная поликлиника №…", kind: "clinic",
//   lat: 41.31, lon: 69.24, address: "…", phone: "+998 …", openingHours: "Mo-Fr 08:00-17:00",
//   source: "verified", verified: true, checked: "2026-11-17", sourceUrl: "https://…"
// }
// Пустой список — честное состояние: на карте тогда показываются только данные OpenStreetMap с пометкой «не проверено».
export const VERIFIED_FACILITIES: Facility[] = [];
