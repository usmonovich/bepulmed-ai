// Кладёт движок и языковые модели Tesseract в public/ocr, чтобы сканер работал без интернета и без CDN.
// Запускается автоматически перед `npm run build` и `npm run dev`.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const out = new URL("../public/ocr/", import.meta.url).pathname;
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "core"), { recursive: true });
mkdirSync(join(out, "lang"), { recursive: true });

cpSync(join(pkgDir("tesseract.js"), "dist/worker.min.js"), join(out, "worker.min.js"));
// Только LSTM-ядра (OEM 1): с поддержкой SIMD и без — выбирается автоматически.
for (const f of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"]) cpSync(join(pkgDir("tesseract.js-core"), f), join(out, "core", f));
for (const lang of ["rus", "eng", "uzb"]) {
  const src = join(pkgDir(`@tesseract.js-data/${lang}`), "4.0.0_best_int", `${lang}.traineddata.gz`);
  if (!existsSync(src)) throw new Error(`нет ${src}`);
  cpSync(src, join(out, "lang", `${lang}.traineddata.gz`));
}
console.log("OCR offline files →", out);
