import type {
  SparkplugDecodedPayload,
  SparkplugDeviceState,
  SparkplugTopicInfo,
} from "../../types/sparkplug";
import { isBirth, isDeath, sparkplugDeviceKey } from "./topic";

/** Maximum metrics retained per device (NBIRTHs can carry hundreds). */
export const SPARKPLUG_METRICS_CAP = 500;

/**
 * Apply a Sparkplug message's lifecycle effect to a device state.
 * Creates the state when `prev` is undefined; otherwise updates it in place
 * and returns it (matching the store's mutate-then-bump-version pattern).
 * Deterministic — `now` is injected, no I/O. Returns null for STATE topics,
 * which carry host-application (not edge/device) identity.
 *
 * Semantics:
 * - BIRTH  -> online (records lastBirthTimestamp)
 * - DEATH  -> offline (NDEATH device cascade is handled by cascadeEdgeDeath)
 * - DATA   -> online (deliberate deviation from strict spec: a late
 *             subscriber never sees the non-retained BIRTH, and live DATA
 *             proves the device is alive) + records lastDataTimestamp
 * - CMD    -> recorded as lastMessageType only (commands are host->device,
 *             they say nothing about device state)
 */
export function applySparkplugLifecycle(
  prev: SparkplugDeviceState | undefined,
  info: SparkplugTopicInfo,
  nodeId: string,
  now: number,
): SparkplugDeviceState | null {
  const deviceKey = sparkplugDeviceKey(info);
  if (deviceKey === null) return null;

  const state: SparkplugDeviceState = prev ?? {
    deviceKey,
    role: info.deviceId !== null ? "device" : "edge-node",
    groupId: info.groupId,
    edgeNodeId: info.edgeNodeId,
    deviceId: info.deviceId,
    online: false,
    lastMessageType: info.messageType,
    lastBirthTimestamp: null,
    lastDataTimestamp: null,
    lastSeq: null,
    seqGapCount: 0,
    metrics: new Map(),
    topicNodeIds: new Set(),
  };

  state.lastMessageType = info.messageType;
  state.topicNodeIds.add(nodeId);

  if (isBirth(info.messageType)) {
    state.online = true;
    state.lastBirthTimestamp = now;
    // A new birth restarts the seq sequence and redefines the metric set
    state.lastSeq = null;
  } else if (isDeath(info.messageType)) {
    state.online = false;
  } else if (info.messageType === "NDATA" || info.messageType === "DDATA") {
    state.online = true;
    state.lastDataTimestamp = now;
  }
  // NCMD/DCMD: lastMessageType recorded above, no state change

  return state;
}

/**
 * An NDEATH for an edge node implies all its devices are offline too
 * (the edge's MQTT session died — per the Sparkplug spec, device state
 * cannot outlive its edge node). Returns the keys it marked offline.
 */
export function cascadeEdgeDeath(
  devices: Map<string, SparkplugDeviceState>,
  groupId: string,
  edgeNodeId: string,
): string[] {
  const affected: string[] = [];
  for (const [key, state] of devices) {
    if (
      state.groupId === groupId &&
      state.edgeNodeId === edgeNodeId &&
      state.role === "device" &&
      state.online
    ) {
      state.online = false;
      affected.push(key);
    }
  }
  return affected;
}

/**
 * Merge a decoded payload's metrics into a device state (in place).
 */
export function applySparkplugMetrics(
  state: SparkplugDeviceState,
  decoded: SparkplugDecodedPayload,
): void {
  for (const metric of decoded.metrics) {
    if (metric.name === null) continue;
    if (!state.metrics.has(metric.name) && state.metrics.size >= SPARKPLUG_METRICS_CAP) {
      continue; // cap reached — keep updating known metrics, drop new ones
    }
    state.metrics.set(metric.name, metric);
  }
}

/**
 * Track a payload seq number (in place). Per the Sparkplug spec, seq is a
 * single 0-255 wraparound counter PER EDGE NODE shared across all its node
 * and device messages — so this must be applied to the edge node's entry,
 * not the device's. Gaps are approximate (a lower bound): DATA analysis is
 * debounced upstream, so coalesced messages can also register as gaps.
 */
export function applySparkplugSeq(
  edgeState: SparkplugDeviceState,
  seq: number | null,
): void {
  if (seq === null) return;
  if (edgeState.lastSeq !== null && seq !== (edgeState.lastSeq + 1) % 256) {
    edgeState.seqGapCount++;
  }
  edgeState.lastSeq = seq;
}
