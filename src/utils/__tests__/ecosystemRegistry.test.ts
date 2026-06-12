import { describe, it, expect } from "vitest";
import { ECOSYSTEM_REGISTRY, getEcosystemDefinition } from "../ecosystemRegistry";

describe("ECOSYSTEM_REGISTRY", () => {
  it("has unique ids", () => {
    const ids = ECOSYSTEM_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has valid hex colours", () => {
    for (const def of ECOSYSTEM_REGISTRY) {
      expect(def.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("has a multi-level wildcard topic filter per ecosystem", () => {
    for (const def of ECOSYSTEM_REGISTRY) {
      expect(def.topicFilter.length).toBeGreaterThan(0);
      expect(def.topicFilter.endsWith("#")).toBe(true);
    }
  });

  it("looks up definitions by id and throws on unknown ids", () => {
    expect(getEcosystemDefinition("sparkplug").label).toBe("Sparkplug B");
    expect(() => getEcosystemDefinition("nope" as never)).toThrow();
  });
});
