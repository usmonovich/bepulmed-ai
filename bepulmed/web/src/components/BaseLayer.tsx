import { useEffect, useState } from "react";
import { TileLayer, useMap } from "react-leaflet";
import { leafletLayer } from "protomaps-leaflet";
import { mapPack, type MapPack } from "../lib/mapPack";
import { TILE_URL } from "../lib/tiles";
import type { Lang } from "../lib/i18n";

/**
 * Подложка карты. Внутри Ташкента — встроенная векторная карта (работает без интернета),
 * за пределами — тайлы OpenStreetMap по сети с кэшем просмотренного.
 */
export function BaseLayer({ lang }: { lang: Lang }) {
  const map = useMap();
  const [pack, setPack] = useState<MapPack | null>(null);
  useEffect(() => {
    void mapPack().then(setPack);
  }, []);
  useEffect(() => {
    if (!pack) return;
    const [w, s, e, n] = pack.bbox;
    const layer = leafletLayer({
      url: pack.url,
      flavor: "light",
      lang: lang === "uz" ? "uz" : "ru",
      maxDataZoom: pack.maxzoom,
      bounds: [
        [s, w],
        [n, e],
      ],
      noWrap: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Protomaps',
    } as Parameters<typeof leafletLayer>[0]) as unknown as L.Layer;
    layer.addTo(map);
    (layer as unknown as { setZIndex?: (z: number) => void }).setZIndex?.(2);
    return () => {
      map.removeLayer(layer);
    };
  }, [pack, lang, map]);
  return (
    <TileLayer
      url={TILE_URL}
      maxZoom={19}
      zIndex={1}
      attribution={pack ? "" : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}
    />
  );
}
