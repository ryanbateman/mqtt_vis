import { describe, it, expect } from "vitest";
import { TAG_REGISTRY, getTagDefinition, getTag } from "../tagRegistry";
import type { DetectorResult, PayloadTagType } from "../../types/payloadTags";

const ALL_TAG_TYPES: PayloadTagType[] = ["geo", "image", "sparkplug", "homeassistant", "frigate", "shelly"];

describe("TAG_REGISTRY", () => {
  it("has exactly one entry per PayloadTagType", () => {
    const ids = TAG_REGISTRY.map((t) => t.id);
    expect([...ids].sort()).toEqual([...ALL_TAG_TYPES].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique settings keys", () => {
    const keys = TAG_REGISTRY.map((t) => t.settingsKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has valid hex ring colours", () => {
    for (const def of TAG_REGISTRY) {
      expect(def.ringColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("has non-empty labels and tooltips", () => {
    for (const def of TAG_REGISTRY) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.settingsLabel.length).toBeGreaterThan(0);
      expect(def.settingsTooltip.length).toBeGreaterThan(0);
    }
  });
});

describe("getTagDefinition", () => {
  it("returns the definition for each known tag", () => {
    for (const id of ALL_TAG_TYPES) {
      expect(getTagDefinition(id).id).toBe(id);
    }
  });

  it("throws on an unknown tag", () => {
    expect(() => getTagDefinition("nope" as PayloadTagType)).toThrow(/unknown/i);
  });
});

describe("getTag", () => {
  const geoResult: DetectorResult<"geo"> = {
    tag: "geo",
    confidence: 1,
    fieldPath: "lat",
    metadata: { lat: 1, lon: 2, latPath: "lat", lonPath: "lon" },
  };
  const imageResult: DetectorResult<"image"> = {
    tag: "image",
    confidence: 0.95,
    fieldPath: "",
    metadata: { format: "png", subFormat: null, sizeBytes: 100 },
  };

  it("returns the matching tag with narrowed metadata", () => {
    const found = getTag([imageResult, geoResult], "geo");
    expect(found?.metadata.lat).toBe(1);
  });

  it("returns the first match when duplicates exist", () => {
    const other = { ...geoResult, metadata: { ...geoResult.metadata, lat: 9 } };
    expect(getTag([geoResult, other], "geo")?.metadata.lat).toBe(1);
  });

  it("returns undefined when the tag is absent", () => {
    expect(getTag([imageResult], "geo")).toBeUndefined();
  });

  it("handles null and undefined tag lists", () => {
    expect(getTag(null, "geo")).toBeUndefined();
    expect(getTag(undefined, "image")).toBeUndefined();
  });
});
