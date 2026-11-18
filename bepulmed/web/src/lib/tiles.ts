import { isIOSApp } from "./api";

/**
 * Адрес тайлов карты. В iOS-приложении WKWebView не даёт перехватывать https-запросы,
 * поэтому тайлы идут через собственную схему bmtile:// — её обрабатывает нативный офлайн-кэш
 * (сам скачивает с tile.openstreetmap.org и сохраняет). В Android и вебе — обычный адрес OSM.
 */
export const TILE_URL = isIOSApp ? "bmtile://osm/{z}/{x}/{y}.png" : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
