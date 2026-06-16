import { describe, it, expect, beforeEach } from "vitest";
import { recordTasmotaMessage } from "../tasmota";
import { createEntityRegistry, DOMAIN_ENTITY_CAP, type EntityRegistry } from "../entityOps";

function feed(reg: EntityRegistry, topic: string, payload = "") {
  return recordTasmotaMessage(reg, topic, topic, payload);
}

describe("recordTasmotaMessage", () => {
  let reg: EntityRegistry;
  beforeEach(() => {
    reg = createEntityRegistry();
  });

  it("ignores non-Tasmota topics", () => {
    expect(feed(reg, "home/temp", "21")).toBeNull();
    // A tele/ topic with a non-Tasmota leaf on an unknown device is not claimed.
    expect(feed(reg, "tele/foo/CUSTOM", "x")).toBeNull();
    expect(reg.entities.size).toBe(0);
  });

  it("creates a device from a tele STATE topic", () => {
    const hit = feed(reg, "tele/Kueche/STATE", '{"Uptime":"0T1:00:00","POWER":"ON"}')!;
    expect(hit.entity.key).toBe("tasmota:dev:Kueche");
    expect(hit.entity.role).toBe("device");
    expect(hit.entity.ecosystem).toBe("tasmota");
    expect(hit.entity.label).toBe("Kueche");
    expect(hit.entity.anchorTopicId).toBe("tele/Kueche/STATE");
  });

  it("flips online from the LWT", () => {
    feed(reg, "tele/Kueche/STATE", "{}");
    const dev = reg.entities.get("tasmota:dev:Kueche")!;
    expect(dev.online).toBeNull();

    feed(reg, "tele/Kueche/LWT", "Online");
    expect(dev.online).toBe(true);
    feed(reg, "tele/Kueche/LWT", "Offline");
    expect(dev.online).toBe(false);
  });

  it("reads module and version from INFO1", () => {
    feed(reg, "tele/Schiebetuer/INFO1", '{"Info1":{"Module":"HSE-Shader","Version":"3.2.004"}}');
    const dev = reg.entities.get("tasmota:dev:Schiebetuer")!;
    expect(dev.attributes.module).toBe("HSE-Shader");
    expect(dev.attributes.version).toBe("3.2.004");
  });

  it("groups stat/cmnd and custom-leaf topics under a known device", () => {
    feed(reg, "tele/Kueche/STATE", "{}"); // device now known
    feed(reg, "stat/Kueche/RESULT", '{"POWER":"ON"}');
    feed(reg, "cmnd/Kueche/POWER", "ON");
    feed(reg, "tele/Kueche/MUCPIN", "47"); // custom leaf, allowed because known
    const dev = reg.entities.get("tasmota:dev:Kueche")!;
    expect(dev.topicNodeIds.size).toBe(4);

    // The same custom leaf on an *unknown* device is rejected.
    expect(feed(reg, "tele/Unknown/MUCPIN", "47")).toBeNull();
    expect(reg.entities.has("tasmota:dev:Unknown")).toBe(false);
  });

  it("respects the entity cap", () => {
    for (let i = 0; i < DOMAIN_ENTITY_CAP; i++) {
      reg.entities.set(`k${i}`, {
        key: `k${i}`, ecosystem: "tasmota", role: "device", label: `k${i}`,
        parentKey: null, online: null, attributes: {}, anchorTopicId: null,
        topicNodeIds: new Set(),
      });
    }
    expect(feed(reg, "tele/Overflow/STATE", "{}")).toBeNull();
    expect(reg.entities.has("tasmota:dev:Overflow")).toBe(false);
  });
});
