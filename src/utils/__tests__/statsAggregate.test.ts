import { describe, it, expect } from "vitest";
import {
  payloadSizeStats,
  histogramBuckets,
  topByRate,
  topByEventCount,
  tagTypeCounts,
  entityEcosystemCounts,
  PAYLOAD_HISTOGRAM_EDGES,
} from "../statsAggregate";
import type { GraphNode } from "../../types";
import type { DomainEntity } from "../../types/entities";

function node(over: Partial<GraphNode>): GraphNode {
  return {
    id: "t", label: "t", radius: 1, displayRadius: 1, messageRate: 0, aggregateRate: 0,
    depth: 1, pulse: false, pulseTimestamp: 0, pulseRate: 0, payloadTags: null, ...over,
  };
}

function entity(over: Partial<DomainEntity>): DomainEntity {
  return {
    key: "k", ecosystem: "homie", role: "device", label: "k", parentKey: null,
    online: null, attributes: {}, anchorTopicId: null, topicNodeIds: new Set(), ...over,
  };
}

describe("payloadSizeStats", () => {
  it("returns zeros for empty input", () => {
    expect(payloadSizeStats([])).toEqual({ count: 0, avg: 0, median: 0, p95: 0, max: 0 });
  });

  it("handles a single value", () => {
    expect(payloadSizeStats([42])).toEqual({ count: 1, avg: 42, median: 42, p95: 42, max: 42 });
  });

  it("computes median for odd and even counts", () => {
    expect(payloadSizeStats([3, 1, 2]).median).toBe(2); // odd
    expect(payloadSizeStats([1, 2, 3, 4]).median).toBe(2.5); // even
  });

  it("computes avg, p95 (nearest-rank) and max", () => {
    const sizes = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const s = payloadSizeStats(sizes);
    expect(s.avg).toBeCloseTo(50.5);
    expect(s.max).toBe(100);
    expect(s.p95).toBe(95); // ceil(0.95*100)=95 -> index 94 -> value 95
  });
});

describe("histogramBuckets", () => {
  it("places sizes into the bucket [edge[i], edge[i+1])", () => {
    const counts = histogramBuckets([0, 15, 16, 63, 64, 2000000], PAYLOAD_HISTOGRAM_EDGES);
    // edges: 0,16,64,256,1024,4096,16384,Inf -> 7 buckets
    expect(counts).toHaveLength(PAYLOAD_HISTOGRAM_EDGES.length - 1);
    expect(counts[0]).toBe(2); // 0 and 15 -> [0,16)
    expect(counts[1]).toBe(2); // 16 and 63 -> [16,64)
    expect(counts[2]).toBe(1); // 64 -> [64,256)
    expect(counts[6]).toBe(1); // 2,000,000 -> overflow [16384,Inf)
  });

  it("ignores sizes below the first edge", () => {
    expect(histogramBuckets([-5], [0, 10, Infinity])).toEqual([0, 0]);
  });
});

describe("topByRate", () => {
  it("orders by rate desc, breaks ties by aggregate rate, caps at n, drops zero-rate", () => {
    const nodes = [
      node({ id: "a", messageRate: 5, aggregateRate: 5 }),
      node({ id: "b", messageRate: 10, aggregateRate: 10 }),
      node({ id: "c", messageRate: 10, aggregateRate: 20 }), // ties b on rate, higher agg
      node({ id: "d", messageRate: 0 }), // dropped
    ];
    const top = topByRate(nodes, 2);
    expect(top.map((n) => n.id)).toEqual(["c", "b"]);
  });
});

describe("topByEventCount", () => {
  it("groups events by topic and ranks by count, capped at n", () => {
    const events = [
      { topic: "a" }, { topic: "b" }, { topic: "a" }, { topic: "a" }, { topic: "c" }, { topic: "b" },
    ];
    expect(topByEventCount(events, 2)).toEqual([
      { topic: "a", count: 3 },
      { topic: "b", count: 2 },
    ]);
  });

  it("returns empty for no events", () => {
    expect(topByEventCount([], 5)).toEqual([]);
  });
});

describe("tagTypeCounts", () => {
  it("counts nodes per tag, handling multi-tag and untagged nodes", () => {
    const counts = tagTypeCounts([
      node({ payloadTags: ["geo", "homie"] }),
      node({ payloadTags: ["geo"] }),
      node({ payloadTags: [] }),
      node({ payloadTags: null }),
    ]);
    expect(counts.get("geo")).toBe(2);
    expect(counts.get("homie")).toBe(1);
    expect(counts.has("image")).toBe(false);
  });
});

describe("entityEcosystemCounts", () => {
  it("groups entities by ecosystem", () => {
    const counts = entityEcosystemCounts([
      entity({ ecosystem: "homie" }),
      entity({ ecosystem: "homie" }),
      entity({ ecosystem: "frigate" }),
    ]);
    expect(counts.get("homie")).toBe(2);
    expect(counts.get("frigate")).toBe(1);
  });
});
