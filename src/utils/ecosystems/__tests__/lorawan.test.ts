import { describe, it, expect, beforeEach } from "vitest";
import { recordLorawanMessage } from "../lorawan";
import { createEntityRegistry, DOMAIN_ENTITY_CAP, type EntityRegistry } from "../entityOps";

// Real payload skeletons captured from the live broker probe.
const TTN_UP = JSON.stringify({
  end_device_ids: {
    device_id: "teh2-flexsensor-0e00",
    application_ids: { application_id: "west14-83909" },
    dev_eui: "7066E1FFFE000E00",
    join_eui: "7066E1FFFE000E01",
  },
  uplink_message: {
    f_port: 1,
    rx_metadata: [{ gateway_ids: { gateway_id: "gw1" }, rssi: -100, snr: 7, location: { latitude: 52.1, longitude: 4.9 } }],
  },
});
const CS_V3_RX = JSON.stringify({
  applicationID: "9",
  applicationName: "JCS Power Meters",
  deviceName: "L2 Engineering",
  devEui: "0001011dff000908",
  rxInfo: [{ gatewayID: "54d0b4fffe37efdd", location: { latitude: 50.1, longitude: 8.6 }, rssi: -80, loRaSNR: 9 }],
});
const CS_V3_JOIN = JSON.stringify({
  applicationID: "2",
  applicationName: "WM_App",
  deviceName: "dev_00000072",
  devEUI: "ff01008000000072",
  devAddr: "01b80a97",
});
const CS_V4_UP = JSON.stringify({
  deviceInfo: { applicationId: "abc", applicationName: "V4 App", deviceName: "sensor-1", devEui: "aabbccddeeff0011" },
  devAddr: "00112233",
  fCnt: 5,
  fPort: 2,
  rxInfo: [{ gatewayId: "gw", location: { latitude: 51.0, longitude: 0.1 } }],
  object: {},
});

describe("recordLorawanMessage", () => {
  let registry: EntityRegistry;
  beforeEach(() => {
    registry = createEntityRegistry();
  });

  it("ignores non-LoRaWAN topics", () => {
    expect(recordLorawanMessage(registry, "home/temp", "home/temp", "21")).toBeNull();
    expect(registry.entities.size).toBe(0);
  });

  it("builds a TTN application -> device tree from end_device_ids", () => {
    const topic = "v3/west14-83909@ttn/devices/teh2-flexsensor-0e00/up";
    const hit = recordLorawanMessage(registry, topic, topic, TTN_UP)!;

    expect(hit.entity.key).toBe("ttn:dev:west14-83909/teh2-flexsensor-0e00");
    expect(hit.entity.ecosystem).toBe("ttn");
    expect(hit.entity.role).toBe("device");
    expect(hit.entity.label).toBe("teh2-flexsensor-0e00");
    expect(hit.entity.parentKey).toBe("ttn:app:west14-83909");
    expect(hit.entity.attributes.dev_eui).toBe("7066E1FFFE000E00");
    expect(hit.entity.anchorTopicId).toBe(topic);
    expect(hit.entity.online).toBe(true);

    const app = registry.entities.get("ttn:app:west14-83909")!;
    expect(app.role).toBe("application");
    expect(app.parentKey).toBeNull();
  });

  it("falls back to TTN topic segments when the payload lacks ids", () => {
    const topic = "v3/myapp@ttn/devices/mydev/up";
    const hit = recordLorawanMessage(registry, topic, topic, "{}")!;
    expect(hit.entity.key).toBe("ttn:dev:myapp/mydev");
    expect(hit.entity.online).toBe(true);
  });

  it("builds a ChirpStack v3 tree (devEui) and flips online on rx", () => {
    const topic = "application/9/device/rx/0001011dff000908";
    const hit = recordLorawanMessage(registry, topic, topic, CS_V3_RX)!;

    expect(hit.entity.key).toBe("chirpstack:dev:9/0001011dff000908");
    expect(hit.entity.ecosystem).toBe("chirpstack");
    expect(hit.entity.label).toBe("L2 Engineering");
    expect(hit.entity.attributes.dev_eui).toBe("0001011dff000908");
    expect(hit.entity.online).toBe(true);
    expect(registry.entities.get("chirpstack:app:9")!.label).toBe("JCS Power Meters");
  });

  it("builds a ChirpStack v3 tree on a join (devEUI uppercase)", () => {
    const topic = "application/2/device/join/ff01008000000072";
    const hit = recordLorawanMessage(registry, topic, topic, CS_V3_JOIN)!;
    expect(hit.entity.key).toBe("chirpstack:dev:2/ff01008000000072");
    expect(hit.entity.label).toBe("dev_00000072");
    expect(hit.entity.online).toBe(true); // join counts as heard
  });

  it("builds a ChirpStack v4 tree from the deviceInfo block", () => {
    const topic = "application/abc/device/aabbccddeeff0011/event/up";
    const hit = recordLorawanMessage(registry, topic, topic, CS_V4_UP)!;
    expect(hit.entity.key).toBe("chirpstack:dev:abc/aabbccddeeff0011");
    expect(hit.entity.label).toBe("sensor-1");
    expect(hit.entity.parentKey).toBe("chirpstack:app:abc");
    expect(registry.entities.get("chirpstack:app:abc")!.label).toBe("V4 App");
    expect(hit.entity.online).toBe(true);
  });

  it("does not claim a generic application/ topic without a ChirpStack payload", () => {
    expect(recordLorawanMessage(registry, "application/foo/device/bar", "n", "{}")).toBeNull();
    expect(recordLorawanMessage(registry, "application/x/device/y", "n", "not-json")).toBeNull();
    expect(registry.entities.size).toBe(0);
  });

  it("respects the entity cap", () => {
    for (let i = 0; i < DOMAIN_ENTITY_CAP; i++) {
      registry.entities.set(`k${i}`, {
        key: `k${i}`, ecosystem: "ttn", role: "device", label: `k${i}`,
        parentKey: null, online: null, attributes: {}, anchorTopicId: null,
        topicNodeIds: new Set(),
      });
    }
    const topic = "v3/over@ttn/devices/flow/up";
    expect(recordLorawanMessage(registry, topic, topic, "{}")).toBeNull();
    expect(registry.entities.has("ttn:app:over")).toBe(false);
  });
});
