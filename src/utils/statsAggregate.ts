import type { GraphNode } from "../types";
import type { PayloadTagType } from "../types/payloadTags";
import type { DomainEntity, EcosystemId } from "../types/entities";

/**
 * Pure aggregation helpers for the Stats dashboard (#16). All operate over
 * snapshots — the store keeps no time series or per-message history — so the
 * panel computes these on a timer from the current node/entity state.
 */

/** Summary statistics over a set of payload sizes (character lengths). */
export interface PayloadSizeStats {
  count: number;
  avg: number;
  median: number;
  /** 95th percentile (nearest-rank). */
  p95: number;
  max: number;
}

/** Percentile (nearest-rank, 0..1) over an already-sorted ascending array. */
function percentileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(q * sorted.length);
  const idx = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[idx];
}

/** Avg / median / p95 / max over payload sizes. Empty input → all zeros. */
export function payloadSizeStats(sizes: number[]): PayloadSizeStats {
  if (sizes.length === 0) return { count: 0, avg: 0, median: 0, p95: 0, max: 0 };
  const sorted = [...sizes].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, n) => acc + n, 0);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return {
    count: sorted.length,
    avg: sum / sorted.length,
    median,
    p95: percentileSorted(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
}

/** Default histogram boundaries (chars): [0,16),[16,64)…[16384,∞). */
export const PAYLOAD_HISTOGRAM_EDGES = [0, 16, 64, 256, 1024, 4096, 16384, Infinity];

/**
 * Count sizes into the buckets between consecutive `edges`. Returns an array
 * of length `edges.length - 1`; a size s lands in bucket i where
 * edges[i] <= s < edges[i+1]. Sizes below edges[0] are ignored.
 */
export function histogramBuckets(sizes: number[], edges: number[]): number[] {
  const counts = new Array(Math.max(edges.length - 1, 0)).fill(0);
  for (const s of sizes) {
    for (let i = 0; i < counts.length; i++) {
      if (s >= edges[i] && s < edges[i + 1]) {
        counts[i]++;
        break;
      }
    }
  }
  return counts;
}

/**
 * The n noisiest topics by direct message rate (aggregate rate breaks ties).
 * Only nodes with a positive rate are returned.
 */
export function topByRate(nodes: GraphNode[], n: number): GraphNode[] {
  return nodes
    .filter((node) => node.messageRate > 0)
    .sort((a, b) => b.messageRate - a.messageRate || b.aggregateRate - a.aggregateRate)
    .slice(0, n);
}

/** Count nodes whose payload tags include each tag type (one count per tag seen). */
export function tagTypeCounts(nodes: GraphNode[]): Map<PayloadTagType, number> {
  const counts = new Map<PayloadTagType, number>();
  for (const node of nodes) {
    if (!node.payloadTags) continue;
    for (const tag of node.payloadTags) {
      counts.set(tag as PayloadTagType, (counts.get(tag as PayloadTagType) ?? 0) + 1);
    }
  }
  return counts;
}

/** Count identified entities grouped by ecosystem. */
export function entityEcosystemCounts(entities: DomainEntity[]): Map<EcosystemId, number> {
  const counts = new Map<EcosystemId, number>();
  for (const entity of entities) {
    counts.set(entity.ecosystem, (counts.get(entity.ecosystem) ?? 0) + 1);
  }
  return counts;
}
