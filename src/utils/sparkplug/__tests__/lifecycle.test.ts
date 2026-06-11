import { describe, it, expect } from "vitest";
import {
  applySparkplugLifecycle,
  applySparkplugMetrics,
  applySparkplugSeq,
  cascadeEdgeDeath,
  SPARKPLUG_METRICS_CAP,
} from "../lifecycle";
import { recordAliases, resolveAliases, type AliasMap } from "../aliases";
import { parseSparkplugTopic } from "../topic";
import type { SparkplugDeviceState, SparkplugMetric } from "../../../types/sparkplug";

const NOW = 1_750_000_000_000;

function apply(
  prev: SparkplugDeviceState | undefined,
  topic: string,
  nodeId = topic,
  now = NOW,
) {
  const info = parseSparkplugTopic(topic);
  expect(info).not.toBeNull();
  return applySparkplugLifecycle(prev, info!, nodeId, now);
}

function metric(name: string, value: number, alias?: number): SparkplugMetric {
  return {
    name,
    alias: alias ?? null,
    datatype: 10,
    datatypeName: "Double",
    value,
    timestamp: null,
    isNull: false,
  };
}

describe("applySparkplugLifecycle", () => {
  it("creates an online edge-node state on NBIRTH", () => {
    const state = apply(undefined, "spBv1.0/g/NBIRTH/e")!;
    expect(state.deviceKey).toBe("g/e");
    expect(state.role).toBe("edge-node");
    expect(state.online).toBe(true);
    expect(state.lastBirthTimestamp).toBe(NOW);
    expect(state.lastMessageType).toBe("NBIRTH");
  });

  it("creates a device state on DBIRTH", () => {
    const state = apply(undefined, "spBv1.0/g/DBIRTH/e/d")!;
    expect(state.deviceKey).toBe("g/e/d");
    expect(state.role).toBe("device");
    expect(state.deviceId).toBe("d");
    expect(state.online).toBe(true);
  });

  it("marks offline on NDEATH and DDEATH", () => {
    let state = apply(undefined, "spBv1.0/g/NBIRTH/e")!;
    state = apply(state, "spBv1.0/g/NDEATH/e")!;
    expect(state.online).toBe(false);
    expect(state.lastMessageType).toBe("NDEATH");

    let dev = apply(undefined, "spBv1.0/g/DBIRTH/e/d")!;
    dev = apply(dev, "spBv1.0/g/DDEATH/e/d")!;
    expect(dev.online).toBe(false);
  });

  it("DATA implies alive (late-subscriber semantics)", () => {
    // No BIRTH ever seen — DATA still marks the device online
    const state = apply(undefined, "spBv1.0/g/NDATA/e")!;
    expect(state.online).toBe(true);
    expect(state.lastDataTimestamp).toBe(NOW);
    expect(state.lastBirthTimestamp).toBeNull();
  });

  it("DATA revives a dead device", () => {
    let state = apply(undefined, "spBv1.0/g/NDEATH/e")!;
    expect(state.online).toBe(false);
    state = apply(state, "spBv1.0/g/NDATA/e")!;
    expect(state.online).toBe(true);
  });

  it("CMD records the message type but does not change online state", () => {
    let state = apply(undefined, "spBv1.0/g/NDEATH/e")!;
    state = apply(state, "spBv1.0/g/NCMD/e")!;
    expect(state.online).toBe(false);
    expect(state.lastMessageType).toBe("NCMD");
  });

  it("returns null for STATE topics (host identity, not device)", () => {
    expect(apply(undefined, "STATE/host1")).toBeNull();
    expect(apply(undefined, "spBv1.0/STATE/host1")).toBeNull();
  });

  it("accumulates topicNodeIds across sibling message-type subtrees", () => {
    let state = apply(undefined, "spBv1.0/g/NBIRTH/e", "spBv1.0/g/NBIRTH/e")!;
    state = apply(state, "spBv1.0/g/NDATA/e", "spBv1.0/g/NDATA/e")!;
    state = apply(state, "spBv1.0/g/NDEATH/e", "spBv1.0/g/NDEATH/e")!;
    expect([...state.topicNodeIds].sort()).toEqual([
      "spBv1.0/g/NBIRTH/e",
      "spBv1.0/g/NDATA/e",
      "spBv1.0/g/NDEATH/e",
    ]);
  });

  it("a new BIRTH resets seq tracking", () => {
    let state = apply(undefined, "spBv1.0/g/NBIRTH/e")!;
    applySparkplugSeq(state, 5);
    expect(state.lastSeq).toBe(5);
    state = apply(state, "spBv1.0/g/NBIRTH/e")!;
    expect(state.lastSeq).toBeNull();
  });
});

describe("cascadeEdgeDeath", () => {
  it("marks the edge's online devices offline, leaves others", () => {
    const devices = new Map<string, SparkplugDeviceState>();
    const edge = apply(undefined, "spBv1.0/g/NBIRTH/e")!;
    const d1 = apply(undefined, "spBv1.0/g/DBIRTH/e/d1")!;
    const d2 = apply(undefined, "spBv1.0/g/DBIRTH/e/d2")!;
    const other = apply(undefined, "spBv1.0/g/DBIRTH/otherEdge/d")!;
    for (const s of [edge, d1, d2, other]) devices.set(s.deviceKey, s);

    const affected = cascadeEdgeDeath(devices, "g", "e");
    expect(affected.sort()).toEqual(["g/e/d1", "g/e/d2"]);
    expect(d1.online).toBe(false);
    expect(d2.online).toBe(false);
    expect(other.online).toBe(true);
    // The edge node itself is handled by its own NDEATH lifecycle, not the cascade
    expect(edge.online).toBe(true);
  });
});

describe("applySparkplugMetrics", () => {
  it("merges metrics and updates existing ones", () => {
    const state = apply(undefined, "spBv1.0/g/NBIRTH/e")!;
    applySparkplugMetrics(state, {
      timestamp: null,
      seq: 0,
      metrics: [metric("Temp", 20), metric("Pressure", 100)],
    });
    applySparkplugMetrics(state, {
      timestamp: null,
      seq: 1,
      metrics: [metric("Temp", 21)],
    });
    expect(state.metrics.size).toBe(2);
    expect(state.metrics.get("Temp")?.value).toBe(21);
    expect(state.metrics.get("Pressure")?.value).toBe(100);
  });

  it("skips unnamed metrics", () => {
    const state = apply(undefined, "spBv1.0/g/NBIRTH/e")!;
    applySparkplugMetrics(state, {
      timestamp: null,
      seq: null,
      metrics: [{ ...metric("x", 1), name: null }],
    });
    expect(state.metrics.size).toBe(0);
  });

  it("caps stored metrics but keeps updating known ones", () => {
    const state = apply(undefined, "spBv1.0/g/NBIRTH/e")!;
    const many = Array.from({ length: SPARKPLUG_METRICS_CAP }, (_, i) => metric(`m${i}`, i));
    applySparkplugMetrics(state, { timestamp: null, seq: null, metrics: many });
    expect(state.metrics.size).toBe(SPARKPLUG_METRICS_CAP);

    applySparkplugMetrics(state, {
      timestamp: null,
      seq: null,
      metrics: [metric("overflow", 1), metric("m0", 999)],
    });
    expect(state.metrics.has("overflow")).toBe(false); // dropped at cap
    expect(state.metrics.get("m0")?.value).toBe(999); // known metric still updates
  });
});

describe("applySparkplugSeq", () => {
  it("counts seq gaps with 0-255 wraparound", () => {
    const state = apply(undefined, "spBv1.0/g/NBIRTH/e")!;
    applySparkplugSeq(state, 254);
    applySparkplugSeq(state, 255);
    applySparkplugSeq(state, 0); // wraps cleanly
    expect(state.seqGapCount).toBe(0);
    applySparkplugSeq(state, 5); // gap (1-4 missing)
    expect(state.seqGapCount).toBe(1);
    expect(state.lastSeq).toBe(5);
  });

  it("ignores null seq", () => {
    const state = apply(undefined, "spBv1.0/g/NBIRTH/e")!;
    applySparkplugSeq(state, null);
    expect(state.lastSeq).toBeNull();
    expect(state.seqGapCount).toBe(0);
  });
});

describe("alias map", () => {
  it("records aliases from BIRTH and resolves alias-only DATA metrics", () => {
    const map: AliasMap = new Map();
    recordAliases(map, [metric("Temp", 20, 1), metric("Pressure", 100, 2)]);

    const dataMetrics: SparkplugMetric[] = [
      { ...metric("ignored", 21, 1), name: null, datatype: 0 },
      { ...metric("ignored", 101, 2), name: null },
    ];
    resolveAliases(map, dataMetrics);
    expect(dataMetrics[0].name).toBe("Temp");
    expect(dataMetrics[0].datatype).toBe(10); // backfilled from BIRTH
    expect(dataMetrics[1].name).toBe("Pressure");
  });

  it("labels unknown aliases as alias:N (late subscriber)", () => {
    const map: AliasMap = new Map();
    const m: SparkplugMetric[] = [{ ...metric("x", 1, 9), name: null }];
    resolveAliases(map, m);
    expect(m[0].name).toBe("alias:9");
  });

  it("does not overwrite named metrics", () => {
    const map: AliasMap = new Map([[1, { name: "Temp", datatype: 10 }]]);
    const m: SparkplugMetric[] = [metric("Explicit", 5, 1)];
    resolveAliases(map, m);
    expect(m[0].name).toBe("Explicit");
  });
});
