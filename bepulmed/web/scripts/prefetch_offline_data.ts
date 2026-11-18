// Снимок аптек, поликлиник и больниц Ташкента из OpenStreetMap для первого запуска без интернета.
// Запуск (нужен интернет): npx tsx scripts/prefetch_offline_data.ts → public/data/tashkent_osm.json
import { mkdirSync, writeFileSync } from "node:fs";
import { compact, overpass, tashkentQuery } from "../src/lib/offline";

const els = compact(await overpass(tashkentQuery(), fetch, 180000));
if (els.length < 200) throw new Error(`Слишком мало объектов (${els.length}) — Overpass ответил неполностью`);
mkdirSync("public/data", { recursive: true });
writeFileSync("public/data/tashkent_osm.json", JSON.stringify({ fetchedAt: new Date().toISOString(), elements: els }));
console.log(`✅ public/data/tashkent_osm.json — ${els.length} объектов`);
