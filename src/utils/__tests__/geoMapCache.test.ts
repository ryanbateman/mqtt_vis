import { describe, it, expect, beforeEach } from "vitest";
import { geoMapCache, clearGeoMapCache } from "../geoMapCache";

describe("geoMapCache", () => {
  beforeEach(() => {
    clearGeoMapCache();
  });

  it("starts empty", () => {
    expect(geoMapCache.view).toBeNull();
    expect(geoMapCache.trails.size).toBe(0);
  });

  it("retains the viewport across reads (survives panel remount)", () => {
    geoMapCache.view = { center: [51.5, -0.12], zoom: 11 };
    expect(geoMapCache.view).toEqual({ center: [51.5, -0.12], zoom: 11 });
  });

  it("retains trail points keyed by topic path", () => {
    geoMapCache.trails.set("owntracks/a/phone", {
      trail: [{ lat: 1, lon: 2, timestamp: 1000 }],
      prevPos: { lat: 3, lon: 4, timestamp: 2000 },
    });

    const cached = geoMapCache.trails.get("owntracks/a/phone");
    expect(cached?.trail).toHaveLength(1);
    expect(cached?.prevPos).toEqual({ lat: 3, lon: 4, timestamp: 2000 });
  });

  it("clearGeoMapCache drops both the viewport and every trail", () => {
    geoMapCache.view = { center: [0, 0], zoom: 5 };
    geoMapCache.trails.set("a/b", {
      trail: [{ lat: 1, lon: 1, timestamp: 1 }],
      prevPos: { lat: 1, lon: 1 },
    });

    clearGeoMapCache();

    expect(geoMapCache.view).toBeNull();
    expect(geoMapCache.trails.size).toBe(0);
  });

  it("keeps the same Map instance after clearing (holders keep a live reference)", () => {
    const before = geoMapCache.trails;
    geoMapCache.trails.set("a/b", { trail: [], prevPos: { lat: 0, lon: 0 } });
    clearGeoMapCache();
    expect(geoMapCache.trails).toBe(before);
  });
});
