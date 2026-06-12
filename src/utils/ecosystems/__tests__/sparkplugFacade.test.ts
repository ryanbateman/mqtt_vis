import { describe, it, expect } from "vitest";
import { sparkplugEntitiesView } from "../sparkplugFacade";
import type { SparkplugDeviceState, SparkplugMetric } from "../../../types/sparkplug";

function makeDevice(overrides: Partial<SparkplugDeviceState>): SparkplugDeviceState {
  return {
    deviceKey: "plant/edge-01",
    role: "edge-node",
    groupId: "plant",
    edgeNodeId: "edge-01",
    deviceId: null,
    online: true,
    lastMessageType: "NBIRTH",
    lastBirthTimestamp: 1000,
    lastDataTimestamp: null,
    lastSeq: 0,
    seqGapCount: 0,
    metrics: new Map<string, SparkplugMetric>(),
    topicNodeIds: new Set<string>(),
    ...overrides,
  };
}

describe("sparkplugEntitiesView", () => {
  it("projects an edge node to a top-level entity", () => {
    const devices = new Map([["plant/edge-01", makeDevice({})]]);
    const [entity] = sparkplugEntitiesView(devices);

    expect(entity.key).toBe("sparkplug:plant/edge-01");
    expect(entity.ecosystem).toBe("sparkplug");
    expect(entity.role).toBe("edge-node");
    expect(entity.label).toBe("edge-01");
    expect(entity.parentKey).toBeNull();
    expect(entity.online).toBe(true);
    expect(entity.attributes.group).toBe("plant");
  });

  it("projects a device with its edge node as parent", () => {
    const devices = new Map([
      [
        "plant/edge-01/sensor-7",
        makeDevice({
          deviceKey: "plant/edge-01/sensor-7",
          role: "device",
          deviceId: "sensor-7",
          online: false,
        }),
      ],
    ]);
    const [entity] = sparkplugEntitiesView(devices);

    expect(entity.key).toBe("sparkplug:plant/edge-01/sensor-7");
    expect(entity.label).toBe("sensor-7");
    expect(entity.parentKey).toBe("sparkplug:plant/edge-01");
    expect(entity.online).toBe(false);
  });

  it("prefers the DATA topic as anchor, then BIRTH, then first seen", () => {
    const dataPreferred = makeDevice({
      topicNodeIds: new Set([
        "spBv1.0/plant/NBIRTH/edge-01",
        "spBv1.0/plant/NDATA/edge-01",
      ]),
    });
    const birthFallback = makeDevice({
      topicNodeIds: new Set([
        "spBv1.0/plant/NCMD/edge-01",
        "spBv1.0/plant/NBIRTH/edge-01",
      ]),
    });
    const firstFallback = makeDevice({
      topicNodeIds: new Set(["spBv1.0/plant/NCMD/edge-01"]),
    });
    const empty = makeDevice({});

    expect(sparkplugEntitiesView(new Map([["k", dataPreferred]]))[0].anchorTopicId)
      .toBe("spBv1.0/plant/NDATA/edge-01");
    expect(sparkplugEntitiesView(new Map([["k", birthFallback]]))[0].anchorTopicId)
      .toBe("spBv1.0/plant/NBIRTH/edge-01");
    expect(sparkplugEntitiesView(new Map([["k", firstFallback]]))[0].anchorTopicId)
      .toBe("spBv1.0/plant/NCMD/edge-01");
    expect(sparkplugEntitiesView(new Map([["k", empty]]))[0].anchorTopicId).toBeNull();
  });

  it("sorts each edge node directly before its devices", () => {
    const devices = new Map([
      [
        "plant/edge-02/dev-a",
        makeDevice({
          deviceKey: "plant/edge-02/dev-a",
          role: "device",
          edgeNodeId: "edge-02",
          deviceId: "dev-a",
        }),
      ],
      ["plant/edge-01", makeDevice({})],
      [
        "plant/edge-02",
        makeDevice({ deviceKey: "plant/edge-02", edgeNodeId: "edge-02" }),
      ],
    ]);

    const keys = sparkplugEntitiesView(devices).map((e) => e.key);
    expect(keys).toEqual([
      "sparkplug:plant/edge-01",
      "sparkplug:plant/edge-02",
      "sparkplug:plant/edge-02/dev-a",
    ]);
  });

  it("reports the metric count as an attribute", () => {
    const metrics = new Map<string, SparkplugMetric>([
      ["temp", { name: "temp", alias: null, datatype: 9, datatypeName: "Float", value: 1.5, timestamp: null, isNull: false }],
    ]);
    const devices = new Map([["plant/edge-01", makeDevice({ metrics })]]);

    expect(sparkplugEntitiesView(devices)[0].attributes.metrics).toBe("1");
  });
});
