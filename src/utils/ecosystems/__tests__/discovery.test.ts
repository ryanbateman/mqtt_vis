import { describe, it, expect } from "vitest";
import {
  isHaDiscoveryTopic,
  parseHaDiscovery,
  detectHomeAssistant,
} from "../homeassistant/discovery";

describe("isHaDiscoveryTopic", () => {
  it("matches per-entity config topics with and without node_id", () => {
    expect(isHaDiscoveryTopic("homeassistant/sensor/livingroom_temp/config")).toBe(true);
    expect(isHaDiscoveryTopic("homeassistant/sensor/node1/livingroom_temp/config")).toBe(true);
    expect(isHaDiscoveryTopic("homeassistant/device/0xabc/config")).toBe(true);
  });

  it("rejects non-discovery topics", () => {
    expect(isHaDiscoveryTopic("homeassistant/status")).toBe(false);
    expect(isHaDiscoveryTopic("zigbee2mqtt/lamp")).toBe(false);
    expect(isHaDiscoveryTopic("homeassistant/sensor/livingroom_temp/state")).toBe(false);
    expect(isHaDiscoveryTopic("homeassistant/sensor/a/b/c/config")).toBe(false);
  });
});

describe("parseHaDiscovery", () => {
  it("parses a long-form sensor config with a device block", () => {
    const decls = parseHaDiscovery(
      "homeassistant/sensor/livingroom_temp/config",
      JSON.stringify({
        name: "Living Room Temperature",
        unique_id: "lr_temp_1",
        state_topic: "home/livingroom/temperature",
        availability_topic: "home/livingroom/status",
        device_class: "temperature",
        device: {
          identifiers: ["lr-multisensor"],
          name: "Living Room Multisensor",
          manufacturer: "Acme",
          model: "MS-1",
        },
      }),
    );

    expect(decls).toHaveLength(2);
    const [device, entity] = decls;

    expect(device.key).toBe("homeassistant:dev:lr-multisensor");
    expect(device.role).toBe("device");
    expect(device.label).toBe("Living Room Multisensor");
    expect(device.attributes.manufacturer).toBe("Acme");
    expect(device.attributes.model).toBe("MS-1");

    expect(entity.key).toBe("homeassistant:ent:lr_temp_1");
    expect(entity.role).toBe("sensor");
    expect(entity.label).toBe("Living Room Temperature");
    expect(entity.parentKey).toBe("homeassistant:dev:lr-multisensor");
    expect(entity.attributes.device_class).toBe("temperature");
    // device_class doubles as the shared functional type slot.
    expect(entity.attributes.type).toBe("temperature");
    expect(entity.memberTopics[0]).toBe("home/livingroom/temperature");
    expect(entity.availability).toEqual([
      {
        topic: "home/livingroom/status",
        payloadAvailable: "online",
        payloadNotAvailable: "offline",
      },
    ]);
  });

  it("expands zigbee2mqtt-style abbreviations and the ~ base topic", () => {
    const decls = parseHaDiscovery(
      "homeassistant/switch/0x00158d/config",
      JSON.stringify({
        "~": "zigbee2mqtt/kitchen_plug",
        name: "Kitchen Plug",
        uniq_id: "0x00158d_switch",
        stat_t: "~",
        cmd_t: "~/set",
        avty_t: "~/availability",
        dev: {
          ids: ["0x00158d"],
          mf: "Xiaomi",
          mdl: "ZNCZ02LM",
          name: "Kitchen Plug Device",
        },
      }),
    );

    const entity = decls.find((d) => d.role === "switch")!;
    expect(entity.key).toBe("homeassistant:ent:0x00158d_switch");
    expect(entity.memberTopics[0]).toBe("zigbee2mqtt/kitchen_plug");
    expect(entity.memberTopics).toContain("zigbee2mqtt/kitchen_plug/set");
    expect(entity.availability[0].topic).toBe("zigbee2mqtt/kitchen_plug/availability");

    const device = decls.find((d) => d.role === "device")!;
    expect(device.key).toBe("homeassistant:dev:0x00158d");
    expect(device.attributes.manufacturer).toBe("Xiaomi");
  });

  it("parses the availability list form with custom payloads", () => {
    const decls = parseHaDiscovery(
      "homeassistant/binary_sensor/door/config",
      JSON.stringify({
        unique_id: "door_1",
        state_topic: "home/door",
        availability: [
          { topic: "home/door/lwt", pl_avail: "UP", pl_not_avail: "DOWN" },
        ],
      }),
    );

    expect(decls).toHaveLength(1);
    expect(decls[0].parentKey).toBeNull();
    expect(decls[0].availability).toEqual([
      { topic: "home/door/lwt", payloadAvailable: "UP", payloadNotAvailable: "DOWN" },
    ]);
  });

  it("collects unmapped *_t abbreviations as member topics", () => {
    const decls = parseHaDiscovery(
      "homeassistant/light/strip/config",
      JSON.stringify({
        unique_id: "strip_1",
        stat_t: "home/strip/state",
        bri_stat_t: "home/strip/brightness",
        rgb_stat_t: "home/strip/rgb",
      }),
    );

    const topics = decls[0].memberTopics;
    expect(topics[0]).toBe("home/strip/state");
    expect(topics).toContain("home/strip/brightness");
    expect(topics).toContain("home/strip/rgb");
  });

  it("falls back to topic segments for the key when unique_id is missing", () => {
    const decls = parseHaDiscovery(
      "homeassistant/sensor/node1/temp/config",
      JSON.stringify({ state_topic: "n1/temp" }),
    );
    expect(decls[0].key).toBe("homeassistant:ent:sensor.node1.temp");
    expect(decls[0].label).toBe("node1.temp");
  });

  it("parses device-based discovery with a components map", () => {
    const decls = parseHaDiscovery(
      "homeassistant/device/0xbeef/config",
      JSON.stringify({
        "~": "acme/0xbeef",
        dev: { ids: ["0xbeef"], name: "Acme Hub", mdl: "Hub-2" },
        avty_t: "~/lwt",
        cmps: {
          temp: { p: "sensor", uniq_id: "0xbeef_t", stat_t: "~/temperature" },
          relay: { p: "switch", uniq_id: "0xbeef_r", stat_t: "~/relay", cmd_t: "~/relay/set" },
        },
      }),
    );

    expect(decls).toHaveLength(3);
    const device = decls[0];
    expect(device.key).toBe("homeassistant:dev:0xbeef");

    const temp = decls.find((d) => d.key === "homeassistant:ent:0xbeef_t")!;
    expect(temp.role).toBe("sensor");
    expect(temp.parentKey).toBe(device.key);
    expect(temp.memberTopics[0]).toBe("acme/0xbeef/temperature");
    // Shared top-level availability applies to components without their own.
    expect(temp.availability[0].topic).toBe("acme/0xbeef/lwt");

    const relay = decls.find((d) => d.key === "homeassistant:ent:0xbeef_r")!;
    expect(relay.memberTopics).toContain("acme/0xbeef/relay/set");
  });

  it("returns [] for empty, non-JSON, and non-object payloads", () => {
    expect(parseHaDiscovery("homeassistant/sensor/x/config", "")).toEqual([]);
    expect(parseHaDiscovery("homeassistant/sensor/x/config", "not json")).toEqual([]);
    expect(parseHaDiscovery("homeassistant/sensor/x/config", "42")).toEqual([]);
  });
});

describe("detectHomeAssistant", () => {
  it("wraps declarations in a homeassistant tag keyed to the entity", () => {
    const results = detectHomeAssistant(
      "homeassistant/sensor/t1/config",
      JSON.stringify({
        unique_id: "t1",
        name: "T1",
        state_topic: "x/t1",
        device: { identifiers: "devA" },
      }),
    );

    expect(results).toHaveLength(1);
    expect(results[0].tag).toBe("homeassistant");
    const meta = results[0].metadata as { entityKey: string; declarations?: unknown[] };
    expect(meta.entityKey).toBe("homeassistant:ent:t1");
    expect(meta.declarations).toHaveLength(2);
  });

  it("returns [] for non-discovery topics", () => {
    expect(detectHomeAssistant("home/livingroom/temperature", "21.5")).toEqual([]);
  });
});
