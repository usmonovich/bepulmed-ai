// Снимок аптек, поликлиник и больниц Ташкента из OpenStreetMap для первого запуска без интернета.
// Запуск (нужен интернет): npx tsx scripts/prefetch_offline_data.ts → public/data/tashkent_osm.json
import { mkdirSync, writeFileSync } from "node:fs";
import { compact, overpass, tashkentQuery } from "../src/lib/offline";

// Overpass просит указывать User-Agent; при перегрузке отвечает 504/429 — повторяем с паузой.
const ua: typeof fetch = (input, init) => fetch(input, { ...init, headers: { "User-Agent": "BepulMed-AI offline snapshot (github.com/usmonovich/bepulmed-ai)" } });
let raw: Awaited<ReturnType<typeof overpass>> | null = null;
for (let attempt = 1; attempt <= 4 && !raw; attempt++) {
  try {
    raw = await overpass(tashkentQuery(), ua, 180000);
  } catch (e) {
    console.warn(`Попытка ${attempt}: ${(e as Error).message}`);
    if (attempt < 4) await new Promise((r) => setTimeout(r, 30000 * attempt));
  }
}
if (!raw) throw new Error("Overpass недоступен");
const els = compact(raw);
if (els.length < 200) throw new Error(`Слишком мало объектов (${els.length}) — Overpass ответил неполностью`);
mkdirSync("public/data", { recursive: true });
writeFileSync("public/data/tashkent_osm.json", JSON.stringify({ fetchedAt: new Date().toISOString(), elements: els }));
console.log(`✅ public/data/tashkent_osm.json — ${els.length} объектов`);
