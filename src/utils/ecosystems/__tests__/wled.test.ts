import { describe, it, expect, beforeEach } from "vitest";
import { recordWledMessage } from "../wled";
import { createEntityRegistry, DOMAIN_ENTITY_CAP, type EntityRegistry } from "../entityOps";

function feed(reg: EntityRegistry, topic: string, payload = "") {
  return recordWledMessage(reg, topic, topic, payload);
}

// Realistic WLED XML API state skeleton (root element <vs>).
const XML_STATE =
  '<?xml version="1.0" ?><vs><ac>128</ac><cl>255</cl><cl>160</cl><cl>0</cl><ns>0</ns><nr>1</nr><nl>0</nl><nf>1</nf><nd>60</nd><nt>0</nt><fx>0</fx><sx>128</sx><ix>128</ix><fp>0</fp><wv>-1</wv><ws>0</ws><ps>0</ps><cy>0</cy><ds>WLED</ds><ss>0</ss></vs>';

describe("recordWledMessage", () => {
  let reg: EntityRegistry;
  beforeEach(() => {
    reg = createEntityRegistry();
  });

  it("ignores non-WLED topics", () => {
    expect(feed(reg, "home/temp", "21")).toBeNull();
    // A g-shaped payload without a wled segment anywhere is not claimed.
    expect(feed(reg, "lights/desk/g", "128")).toBeNull();
    expect(reg.entities.size).toBe(0);
  });

  it("creates a device from each publish leaf on the default prefix", () => {
    const g = feed(reg, "wled/abc123/g", "128")!;
    expect(g.entity.key).toBe("wled:dev:wled/abc123");
    expect(g.entity.ecosystem).toBe("wled");
    expect(g.entity.role).toBe("device");
    expect(g.entity.label).toBe("abc123");

    expect(feed(reg, "wled/c1/c", "#ffaa00")).not.toBeNull();
    expect(feed(reg, "wled/v1/v", XML_STATE)).not.toBeNull();
    expect(feed(reg, "wled/s1/status", "online")).not.toBeNull();
    expect(reg.entities.size).toBe(4);
  });

  it("detects a wled segment mid-path (open/wled/... namespace)", () => {
    const hit = feed(reg, "open/wled/desk/g", "200")!;
    expect(hit.entity.key).toBe("wled:dev:open/wled/desk");
    expect(hit.entity.label).toBe("desk");

    feed(reg, "open/wled/desk/status", "online");
    expect(reg.entities.get("wled:dev:open/wled/desk")!.online).toBe(true);
    expect(reg.entities.size).toBe(1);
  });

  it("claims a /v XML state under any prefix (no wled segment)", () => {
    const hit = feed(reg, "lights/desk/v", XML_STATE)!;
    expect(hit.entity.key).toBe("wled:dev:lights/desk");
    expect(hit.entity.label).toBe("desk");
  });

  it("rejects publish leaves whose payload shape is wrong", () => {
    expect(feed(reg, "wled/x/g", "hello")).toBeNull();
    expect(feed(reg, "open/wled/desk/g", "hello")).toBeNull();
    expect(feed(reg, "wled/x/g", "999")).toBeNull(); // out of 0-255 range
    expect(feed(reg, "wled/x/c", "red")).toBeNull();
    expect(feed(reg, "wled/x/v", "not xml")).toBeNull();
    expect(feed(reg, "wled/x/status", "ONLINE")).toBeNull(); // lowercase per source
    expect(reg.entities.size).toBe(0);
  });

  it("never creates a device from command topics, but binds them once known", () => {
    // Group/command topics on an unknown device: no phantom entities.
    expect(feed(reg, "wled/all/api", "T")).toBeNull();
    expect(feed(reg, "wled/abc123/col", "#ff0000")).toBeNull();
    expect(feed(reg, "wled/abc123", "ON")).toBeNull();
    expect(reg.entities.size).toBe(0);

    // Once the device published state, its command topics group under it.
    feed(reg, "wled/abc123/g", "64");
    const dev = reg.entities.get("wled:dev:wled/abc123")!;
    expect(feed(reg, "wled/abc123/col", "#ff0000")!.entity).toBe(dev);
    expect(feed(reg, "wled/abc123/api", "A=128")!.entity).toBe(dev);
    expect(feed(reg, "wled/abc123", "ON")!.entity).toBe(dev);
    expect(dev.topicNodeIds.size).toBe(4);
    expect(reg.entities.size).toBe(1);
  });

  it("flips online from the status LWT", () => {
    feed(reg, "wled/abc123/g", "64");
    const dev = reg.entities.get("wled:dev:wled/abc123")!;
    expect(dev.online).toBeNull();

    feed(reg, "wled/abc123/status", "online");
    expect(dev.online).toBe(true);
    feed(reg, "wled/abc123/status", "offline");
    expect(dev.online).toBe(false);
  });

  it("anchors on the /v state topic over earlier leaves", () => {
    feed(reg, "wled/abc123/g", "64");
    const dev = reg.entities.get("wled:dev:wled/abc123")!;
    expect(dev.anchorTopicId).toBe("wled/abc123/g");

    feed(reg, "wled/abc123/v", XML_STATE);
    expect(dev.anchorTopicId).toBe("wled/abc123/v");
    // Later non-v leaves don't steal the anchor back.
    feed(reg, "wled/abc123/c", "#00ff00");
    expect(dev.anchorTopicId).toBe("wled/abc123/v");
  });

  it("captures brightness and colour attributes", () => {
    feed(reg, "wled/abc123/g", "200");
    feed(reg, "wled/abc123/c", "#FFAA00");
    const dev = reg.entities.get("wled:dev:wled/abc123")!;
    expect(dev.attributes.brightness).toBe("200");
    expect(dev.attributes.color).toBe("#ffaa00");
  });

  it("records usermod button/motion states", () => {
    const hit = feed(reg, "wled/abc123/button/0", "on")!;
    expect(hit.entity.key).toBe("wled:dev:wled/abc123");
    // Wrong payload shape for a button is not claimed.
    expect(feed(reg, "wled/other/button/0", "pressed")).toBeNull();
  });

  it("respects the entity cap", () => {
    for (let i = 0; i < DOMAIN_ENTITY_CAP; i++) {
      reg.entities.set(`k${i}`, {
        key: `k${i}`, ecosystem: "wled", role: "device", label: `k${i}`,
        parentKey: null, online: null, attributes: {}, anchorTopicId: null,
        topicNodeIds: new Set(),
      });
    }
    expect(feed(reg, "wled/over/g", "1")).toBeNull();
    expect(reg.entities.has("wled:dev:wled/over")).toBe(false);
  });
});
