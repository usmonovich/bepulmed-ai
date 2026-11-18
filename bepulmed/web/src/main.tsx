import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initTelegram } from "./lib/telegram";

initTelegram();

// Офлайн-кэш только для веб-версии: в Android-приложении всё уже лежит в assets.
if (import.meta.env.PROD && "serviceWorker" in navigator && !window.BepulMedNative && location.hostname !== "appassets.androidplatform.net" && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
