import { describe, expect, it } from "vitest";
import { bearing, compassWord, navInfo } from "./navigate";

describe("навигация без интернета", () => {
  it("направление и расстояние", () => {
    const me = { lat: 41.2771, lon: 69.205 };
    expect(Math.round(bearing(me, { lat: 41.2871, lon: 69.205 }))).toBe(0);
    expect(compassWord(bearing(me, { lat: 41.2771, lon: 69.215 }), "ru")).toBe("на восток");
    expect(compassWord(bearing(me, { lat: 41.27, lon: 69.198 }), "ru")).toBe("на юго-запад");
    const n = navInfo(me, { lat: 41.2861, lon: 69.205 });
    expect(Math.round(n.meters / 10) * 10).toBe(1000);
    expect(n.walkMin).toBe(16);
    expect(n.arrived).toBe(false);
    expect(navInfo(me, { lat: 41.2772, lon: 69.205 }).arrived).toBe(true);
  });
});
