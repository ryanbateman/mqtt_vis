import { describe, it, expect, beforeEach } from "vitest";
import { recordOpenDtuMessage } from "../opendtu";
import { createEntityRegistry, DOMAIN_ENTITY_CAP, type EntityRegistry } from "../entityOps";

const SERIAL = "114183736053";
const SERIAL2 = "116191026601";

function feed(reg: EntityRegistry, topic: string, payload = "0") {
  return recordOpenDtuMessage(reg, topic, topic, payload);
}

describe("recordOpenDtuMessage", () => {
  let reg: EntityRegistry;
  beforeEach(() => {
    reg = createEntityRegistry();
  });

  it("ignores non-OpenDTU topics", () => {
    expect(feed(reg, "home/temp", "21")).toBeNull();
    // AhoyDTU-style traffic that shares the solar/ prefix is not claimed.
    expect(feed(reg, "solar/araria123/ac/w", "0")).toBeNull();
    // A 12-digit serial with an unknown leaf is not enough on its own.
    expect(feed(reg, `solar/${SERIAL}/0/wibble`, "1")).toBeNull();
    expect(reg.entities.size).toBe(0);
  });

  it("builds a DTU -> inverter tree from a channel topic", () => {
    const topic = `solar/${SERIAL}/0/power`;
    const hit = feed(reg, topic, "88.2")!;
    expect(hit.entity.key).toBe(`opendtu:inv:${SERIAL}`);
    expect(hit.entity.role).toBe("inverter");
    expect(hit.entity.ecosystem).toBe("opendtu");
    expect(hit.entity.attributes.type).toBe("inverter");
    expect(hit.entity.parentKey).toBe("opendtu:dtu:solar");
    expect(hit.entity.anchorTopicId).toBe(topic); // 0/power is the anchor

    const dtu = reg.entities.get("opendtu:dtu:solar")!;
    expect(dtu.role).toBe("dtu");
    expect(dtu.parentKey).toBeNull();
  });

  it("groups two inverters under the same DTU base, and DTUs by base", () => {
    feed(reg, `solar/${SERIAL}/0/power`, "10");
    feed(reg, `solar/${SERIAL2}/0/power`, "20");
    expect(reg.entities.get(`opendtu:inv:${SERIAL}`)!.parentKey).toBe("opendtu:dtu:solar");
    expect(reg.entities.get(`opendtu:inv:${SERIAL2}`)!.parentKey).toBe("opendtu:dtu:solar");

    // A custom prefix forms its own DTU entity (a real broker keeps one
    // serial under one base; the inverter keeps its first-seen DTU parent).
    feed(reg, "PV-ST-Mopen/116494407201/0/power", "5");
    expect(reg.entities.get("opendtu:inv:116494407201")!.parentKey).toBe("opendtu:dtu:PV-ST-Mopen");
  });

  it("flips online from status/reachable and sets producing", () => {
    feed(reg, `solar/${SERIAL}/0/power`, "1");
    const inv = reg.entities.get(`opendtu:inv:${SERIAL}`)!;
    expect(inv.online).toBeNull();

    feed(reg, `solar/${SERIAL}/status/reachable`, "1");
    expect(inv.online).toBe(true);
    feed(reg, `solar/${SERIAL}/status/reachable`, "0");
    expect(inv.online).toBe(false);
    feed(reg, `solar/${SERIAL}/status/producing`, "1");
    expect(inv.attributes.producing).toBe("1");
  });

  it("uses the name topic for the inverter label", () => {
    feed(reg, `solar/${SERIAL}/0/power`, "1");
    feed(reg, `solar/${SERIAL}/name`, "PV3Speicher");
    expect(reg.entities.get(`opendtu:inv:${SERIAL}`)!.label).toBe("PV3Speicher");
  });

  it("builds the DTU gateway from dtu/ topics and labels it from hostname", () => {
    const hit = feed(reg, "PV-ST-Mopen/dtu/hostname", "OpenDTU-DFF62C")!;
    expect(hit.entity.key).toBe("opendtu:dtu:PV-ST-Mopen");
    expect(hit.entity.role).toBe("dtu");
    expect(hit.entity.label).toBe("OpenDTU-DFF62C");
    // multi-segment base
    expect(feed(reg, "Garagendach/0815lowe/dtu/ip", "192.168.1.5")!.entity.key)
      .toBe("opendtu:dtu:Garagendach/0815lowe");
  });

  it("respects the entity cap", () => {
    for (let i = 0; i < DOMAIN_ENTITY_CAP; i++) {
      reg.entities.set(`k${i}`, {
        key: `k${i}`, ecosystem: "opendtu", role: "inverter", label: `k${i}`,
        parentKey: null, online: null, attributes: {}, anchorTopicId: null,
        topicNodeIds: new Set(),
      });
    }
    expect(feed(reg, `solar/${SERIAL}/0/power`, "1")).toBeNull();
  });
});
