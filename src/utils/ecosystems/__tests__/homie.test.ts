import { describe, it, expect, beforeEach } from "vitest";
import { recordHomieMessage, createHomieState, isHomieAttributeTopic, type HomieState } from "../homie";
import { createEntityRegistry, type EntityRegistry } from "../entityOps";

/** Feed one attribute message (nodeId = topic for these tests). */
function feed(reg: EntityRegistry, st: HomieState, topic: string, payload: string) {
  return recordHomieMessage(reg, st, topic, topic, payload);
}

describe("isHomieAttributeTopic", () => {
  it("matches topics whose final segment starts with $", () => {
    expect(isHomieAttributeTopic("homie/dev/$homie")).toBe(true);
    expect(isHomieAttributeTopic("homie/dev/node/$properties")).toBe(true);
    expect(isHomieAttributeTopic("homie/dev/node/temperature")).toBe(false);
  });
});

describe("recordHomieMessage", () => {
  let reg: EntityRegistry;
  let st: HomieState;
  beforeEach(() => {
    reg = createEntityRegistry();
    st = createHomieState();
  });

  it("ignores value (non-$) topics", () => {
    expect(feed(reg, st, "homie/example/sensor/temperature", "21.5")).toBeNull();
    expect(reg.entities.size).toBe(0);
  });

  it("builds a device -> node tree from $-attributes", () => {
    feed(reg, st, "homie/example/$homie", "4.0.0");
    feed(reg, st, "homie/example/$name", "Example Sensor");
    feed(reg, st, "homie/example/$nodes", "sensor");
    feed(reg, st, "homie/example/sensor/$name", "Sensor");
    feed(reg, st, "homie/example/sensor/$properties", "temperature,humidity");

    const device = reg.entities.get("homie:dev:homie/example")!;
    expect(device.ecosystem).toBe("homie");
    expect(device.role).toBe("device");
    expect(device.label).toBe("Example Sensor");
    expect(device.attributes.version).toBe("4.0.0");

    const node = reg.entities.get("homie:node:homie/example/sensor")!;
    expect(node.role).toBe("node");
    expect(node.label).toBe("Sensor");
    expect(node.parentKey).toBe("homie:dev:homie/example");

    // Property value topics are claimed: first = primary (anchor), rest = member.
    expect(reg.topicIndex.get("homie/example/sensor/temperature")![0].kind).toBe("primary");
    expect(reg.topicIndex.get("homie/example/sensor/humidity")![0].kind).toBe("member");
  });

  it("maps $state to online and ignores non-conformant states", () => {
    feed(reg, st, "homie/example/$homie", "4.0.0");
    const device = reg.entities.get("homie:dev:homie/example")!;

    feed(reg, st, "homie/example/$state", "ready");
    expect(device.online).toBe(true);
    feed(reg, st, "homie/example/$state", "lost");
    expect(device.online).toBe(false);
    feed(reg, st, "homie/example/$state", "init");
    expect(device.online).toBeNull();

    feed(reg, st, "homie/example/$state", "ready");
    // A device wrongly publishing JSON to $state must not corrupt online.
    feed(reg, st, "homie/example/$state", '{"status":"maintenance"}');
    expect(device.online).toBe(true);
  });

  it("detects Homie at a custom base (e.g. Valetudo)", () => {
    const hit = feed(reg, st, "valetudo/InnocentRunnySeal/$homie", "4.0.0")!;
    expect(hit.entity.key).toBe("homie:dev:valetudo/InnocentRunnySeal");
    expect(hit.entity.label).toBe("InnocentRunnySeal");
  });

  it("buffers attributes that arrive before the device anchor, then drains", () => {
    // $properties arrives before $homie — no device path known yet.
    expect(feed(reg, st, "homie/d/sensor/$properties", "temp")).toBeNull();
    expect(reg.entities.size).toBe(0);

    // $homie registers the device path and drains the buffered $properties.
    feed(reg, st, "homie/d/$homie", "4.0.0");
    expect(reg.entities.has("homie:dev:homie/d")).toBe(true);
    expect(reg.entities.has("homie:node:homie/d/sensor")).toBe(true);
    expect(reg.topicIndex.get("homie/d/sensor/temp")![0].kind).toBe("primary");
  });
});
