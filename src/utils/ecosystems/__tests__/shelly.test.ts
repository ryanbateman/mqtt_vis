import { describe, it, expect, beforeEach } from "vitest";
import {
  isShellyAnnounceTopic,
  parseShellyAnnounce,
  detectShelly,
  recordShellyMessage,
  shellyDeviceType,
} from "../shelly";
import {
  createEntityRegistry,
  applyEntityDeclarations,
  type EntityRegistry,
} from "../entityOps";

const ANNOUNCE = JSON.stringify({
  id: "shellyht-F2BA4B",
  model: "SHHT-1",
  mac: "AABBCCF2BA4B",
  ip: "192.168.1.40",
  fw_ver: "20230913-112531",
  new_fw: false,
});

describe("isShellyAnnounceTopic", () => {
  it("matches global and per-device announce topics", () => {
    expect(isShellyAnnounceTopic("shellies/announce")).toBe(true);
    expect(isShellyAnnounceTopic("shellies/shellyht-F2BA4B/announce")).toBe(true);
  });

  it("rejects other shelly and non-shelly topics", () => {
    expect(isShellyAnnounceTopic("shellies/shellyht-F2BA4B/online")).toBe(false);
    expect(isShellyAnnounceTopic("shellies/a/b/announce")).toBe(false);
    expect(isShellyAnnounceTopic("homeassistant/sensor/x/config")).toBe(false);
  });
});

describe("parseShellyAnnounce / detectShelly", () => {
  it("parses an announce into a device declaration with attributes", () => {
    const decls = parseShellyAnnounce("shellies/announce", ANNOUNCE);
    expect(decls).toHaveLength(1);
    const device = decls[0];
    expect(device.key).toBe("shelly:dev:shellyht-F2BA4B");
    expect(device.role).toBe("device");
    expect(device.label).toBe("shellyht-F2BA4B");
    expect(device.attributes).toEqual({
      model: "SHHT-1",
      mac: "AABBCCF2BA4B",
      ip: "192.168.1.40",
      fw_ver: "20230913-112531",
      type: "H&T sensor",
    });
  });

  it("returns [] for malformed or id-less payloads", () => {
    expect(parseShellyAnnounce("shellies/announce", "not json")).toEqual([]);
    expect(parseShellyAnnounce("shellies/announce", "{}")).toEqual([]);
    expect(parseShellyAnnounce("shellies/announce", "")).toEqual([]);
  });

  it("wraps the declaration in a shelly tag", () => {
    const results = detectShelly("shellies/shellyht-F2BA4B/announce", ANNOUNCE);
    expect(results).toHaveLength(1);
    expect(results[0].tag).toBe("shelly");
    const meta = results[0].metadata as { entityKey: string; declarations?: unknown[] };
    expect(meta.entityKey).toBe("shelly:dev:shellyht-F2BA4B");
    expect(meta.declarations).toHaveLength(1);
  });
});

describe("shellyDeviceType", () => {
  it("maps Gen1, Plus, and Pro topic-id prefixes to functional types", () => {
    expect(shellyDeviceType("shellyht-F2BA4B")).toBe("H&T sensor");
    expect(shellyDeviceType("shellyswitch25-ABC")).toBe("2ch relay");
    expect(shellyDeviceType("shellyplug-s-123")).toBe("plug");
    expect(shellyDeviceType("shellyplus1pm-a0dd6c")).toBe("relay");
    expect(shellyDeviceType("shellypro3em-fce8c0")).toBe("energy meter");
    expect(shellyDeviceType("ShellyWallDisplay-0008221A")).toBe("wall display");
    expect(shellyDeviceType("shelly1-abc")).toBe("relay");
  });

  it("returns null for unrecognised ids", () => {
    expect(shellyDeviceType("not-a-shelly")).toBeNull();
  });
});

describe("recordShellyMessage", () => {
  let registry: EntityRegistry;
  beforeEach(() => {
    registry = createEntityRegistry();
  });

  it("creates a provisional device from structural topics, enriched by a later announce", () => {
    const hit = recordShellyMessage(
      registry,
      "shellies/shellyplus1pm-a0dd6c/switch/0",
      "shellies/shellyplus1pm-a0dd6c/switch/0",
      "on",
    )!;
    expect(hit.entity.key).toBe("shelly:dev:shellyplus1pm-a0dd6c");
    expect(hit.entity.label).toBe("shellyplus1pm-a0dd6c");
    // Provisional entity gets its type from the topic-id prefix.
    expect(hit.entity.attributes).toEqual({ type: "relay" });
    expect(hit.entity.anchorTopicId).toBe("shellies/shellyplus1pm-a0dd6c/switch/0");

    // Announce arrives later — same key, attributes merge in, state survives.
    applyEntityDeclarations(
      registry,
      parseShellyAnnounce(
        "shellies/shellyplus1pm-a0dd6c/announce",
        JSON.stringify({ id: "shellyplus1pm-a0dd6c", model: "SNSW-001P16EU" }),
      ),
    );
    const device = registry.entities.get("shelly:dev:shellyplus1pm-a0dd6c")!;
    expect(device.attributes.model).toBe("SNSW-001P16EU");
    expect(device.anchorTopicId).toBe("shellies/shellyplus1pm-a0dd6c/switch/0");
  });

  it("flips online state from the per-device online LWT", () => {
    recordShellyMessage(registry, "shellies/shelly1-abc/online", "shellies/shelly1-abc/online", "true");
    const device = registry.entities.get("shelly:dev:shelly1-abc")!;
    expect(device.online).toBe(true);

    recordShellyMessage(registry, "shellies/shelly1-abc/online", "shellies/shelly1-abc/online", "false");
    expect(device.online).toBe(false);
  });

  it("skips the global announce and broadcast command topics", () => {
    expect(recordShellyMessage(registry, "shellies/announce", "shellies/announce", ANNOUNCE)).toBeNull();
    expect(recordShellyMessage(registry, "shellies/command", "shellies/command", "announce")).toBeNull();
    expect(registry.entities.size).toBe(0);
  });
});
