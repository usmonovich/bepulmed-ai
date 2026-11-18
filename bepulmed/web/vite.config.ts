import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

// Политика безопасности контента (только для сборки: в dev Vite вставляет свои inline-скрипты).
// Скрипты — только свои и SDK Telegram; WASM для локального OCR; без eval, плагинов и фреймов.
// connect-src https: — адрес сервера BepulMed задаётся в настройках приложения; DMED — *.dhp.uz.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' https: blob: data: http://localhost:* http://127.0.0.1:* http://10.0.2.2:*",
  "img-src 'self' data: blob: https://tile.openstreetmap.org bmtile:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function csp(): Plugin {
  return {
    name: "bepulmed-csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="no-referrer" />`,
      ),
  };
}

export default defineConfig({
  // GitHub Pages публикует проект по адресу /<репозиторий>/ — путь задаётся при сборке (VITE_BASE).
  base: process.env.VITE_BASE || "/",
  plugins: [react(), tailwindcss(), csp()],
  server: { proxy: { "/api": "http://localhost:8787" } },
  test: { environment: "node" },
});
