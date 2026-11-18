import type { Facility } from "./api";
import { distanceMeters } from "./geo";

/** Проверенные учреждения в радиусе + OSM без дублей, по возрастанию расстояния. */
export function mergeFacilities(osm: Facility[], verified: Facility[], at: { lat: number; lon: number }, radius: number): Facility[] {
  const near = verified.filter((v) => distanceMeters(at, v) <= radius);
  // OSM-объект в пределах 60 м от проверенного с тем же типом считаем дублем.
  const rest = osm.filter((o) => !near.some((v) => v.kind === o.kind && distanceMeters(v, o) < 60));
  return [...near, ...rest].sort((a, b) => distanceMeters(at, a) - distanceMeters(at, b));
}
