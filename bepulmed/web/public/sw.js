// BepulMed AI — офлайн-кэш веб-версии (в Android-приложении не используется: там всё лежит в assets).
// Оболочка: сеть → при неудаче кэш. Сборка, OCR-модели: кэш → сеть. Тайлы OSM: только просмотренные, не больше 1500.
// Запросы /api/ не кэшируются (персональные данные не сохраняем в кэше браузера).
const VERSION = "bm-2.10";
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const TILES = "bm-tiles";
const MAX_TILES = 1500;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["./", "./index.html"]).catch(() => undefined)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== STATIC && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

async function cacheFirst(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") {
    await c.put(req, res.clone());
    if (name === TILES) void trimTiles();
  }
  return res;
}

async function networkFirst(req) {
  const c = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) await c.put(req, res.clone());
    return res;
  } catch {
    return (await c.match(req)) || (await c.match("./index.html")) || Response.error();
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "tile.openstreetmap.org") {
    e.respondWith(cacheFirst(req, TILES).catch(() => new Response("", { status: 504 })));
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  if (req.mode === "navigate") {
    e.respondWith(networkFirst(req));
    return;
  }
  if (/\/(assets|ocr)\//.test(url.pathname) || /\.(js|css|wasm|gz|png|svg|woff2?)$/.test(url.pathname)) {
    e.respondWith(cacheFirst(req, STATIC).catch(() => fetch(req)));
  }
});
