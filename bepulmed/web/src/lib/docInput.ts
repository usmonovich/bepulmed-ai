// Чтение документа на устройстве: изображение → OCR (tesseract, файлы в приложении),
// PDF → текстовый слой (pdf.js); если PDF — скан без текста, страницы рендерятся и идут в OCR.
// Ничего не отправляется в сеть.
import { createWorker } from "tesseract.js";

export type Progress = (stage: "prepare" | "ocr" | "pdf", pct: number) => void;

const MAX_PDF_PAGES = 5;

async function ocrImages(images: (Blob | File)[], onProgress: Progress): Promise<string> {
  const ocr = `${import.meta.env.BASE_URL}ocr`;
  let page = 0;
  const worker = await createWorker("rus+eng+uzb", 1, {
    workerPath: `${ocr}/worker.min.js`,
    corePath: `${ocr}/core`,
    langPath: `${ocr}/lang`,
    gzip: true,
    workerBlobURL: false,
    logger: (m) => {
      if (typeof m.progress !== "number") return;
      const st = m.status === "recognizing text" ? "ocr" : "prepare";
      onProgress(st, Math.round(((page + (st === "ocr" ? m.progress : 0)) / images.length) * 100));
    },
  });
  try {
    const out: string[] = [];
    for (; page < images.length; page++) out.push((await worker.recognize(images[page])).data.text.trim());
    return out.filter(Boolean).join("\n\n");
  } finally {
    await worker.terminate();
  }
}

export async function readImage(file: File, onProgress: Progress): Promise<string> {
  return ocrImages([file], onProgress);
}

export async function readPdf(file: File, onProgress: Progress): Promise<{ text: string; ocr: boolean; pages: number }> {
  onProgress("pdf", 0);
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.js?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  // isEvalSupported:false — защита от CVE-2024-4367 (шрифт со встроенным кодом) в pdf.js 3.x.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
  const texts: string[] = [];
  for (let i = 1; i <= pages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    // Собираем строки по координате Y, чтобы «Гемоглобин … 128 … 120-160» остались в одной строке
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of tc.items as { str?: string; transform?: number[] }[]) {
      if (!it.str || !it.transform) continue;
      const y = Math.round(it.transform[5] / 3);
      (rows.get(y) ?? rows.set(y, []).get(y)!).push({ x: it.transform[4], s: it.str });
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r.sort((a, b) => a.x - b.x).map((x) => x.s).join(" ").replace(/\s+/g, " ").trim());
    texts.push(lines.filter(Boolean).join("\n"));
    onProgress("pdf", Math.round((i / pages) * 100));
  }
  const text = texts.join("\n\n").trim();
  if (text.replace(/\s/g, "").length > 40) return { text, ocr: false, pages: doc.numPages };
  // Скан: рендерим страницы и распознаём
  const images: Blob[] = [];
  for (let i = 1; i <= pages; i++) {
    const p = await doc.getPage(i);
    const vp = p.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = vp.width;
    canvas.height = vp.height;
    await p.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
    images.push(await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("canvas"))), "image/png")));
  }
  return { text: await ocrImages(images, onProgress), ocr: true, pages: doc.numPages };
}

// ---- История на устройстве (только по кнопке «Сохранить»; можно удалить) ----
const KEY = "bm_labs_v1";
export interface SavedLab {
  at: string; // ISO
  values: Record<string, number>; // id анализа → значение в канонической единице
}
export function loadHistory(): SavedLab[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function saveHistory(entry: SavedLab): SavedLab[] {
  const all = [...loadHistory(), entry].slice(-30);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* хранилище недоступно */
  }
  return all;
}
export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
/** Предыдущее сохранённое значение показателя (до текущего). */
export function previousValue(history: SavedLab[], id: string): { value: number; at: string } | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const v = history[i].values[id];
    if (typeof v === "number") return { value: v, at: history[i].at };
  }
  return null;
}
