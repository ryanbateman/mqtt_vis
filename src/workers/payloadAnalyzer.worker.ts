import type { WorkerRequest, WorkerResponse, DetectorResult } from "../types/payloadTags";
import type { SparkplugMetadata, SparkplugMetric } from "../types/sparkplug";
import { detectGeo } from "../utils/detectors/geoDetector";
import { detectImage } from "../utils/detectors/imageDetector";
import { parseSparkplugTopic, sparkplugDeviceKey, isBirth, isDeath } from "../utils/sparkplug/topic";
import { decodeSparkplugPayload } from "../utils/sparkplug/decoder";
import { recordAliases, resolveAliases, type AliasMap } from "../utils/sparkplug/aliases";
import { detectHomeAssistant } from "../utils/ecosystems/homeassistant/discovery";
import { detectShelly } from "../utils/ecosystems/shelly";

/**
 * Payload Analyzer Web Worker
 *
 * Runs detector functions off the main thread.  Three detector phases:
 *
 * 1. **Topic-aware detectors** — see the topic, the payload string, and the
 *    raw bytes (when supplied).  Used for protocol detection driven by topic
 *    structure (e.g. Sparkplug B).  A match short-circuits the remaining
 *    phases: such payloads are binary protocol frames, and running the
 *    raw-string heuristics on them risks false positives.
 *
 * 2. **Raw-string detectors** — operate on the raw payload string before
 *    JSON parsing.  Used for binary format detection (e.g. JPEG, PNG)
 *    where the payload is not valid JSON.  Note: image payloads are also
 *    magic-byte-sniffed on the main thread (useMqttClient) to create blob
 *    URLs before UTF-8 decoding mangles the bytes — that path produces the
 *    preview, this one produces the tag.  Both are intentionally kept: the
 *    main thread cannot await the worker before storing the message.
 *
 * 3. **JSON detectors** — operate on the parsed JSON object.  Used for
 *    structured data detection (e.g. geo coordinates).  Skipped when the
 *    payload was truncated by the main thread (cannot parse anyway).
 *
 * The worker holds per-session state for stateful protocols (e.g. sparkplug
 * alias maps); a "reset" message clears it on disconnect/store reset.
 */

/**
 * Per-edge-node alias maps for Sparkplug DATA decoding ("group/edge" keyed).
 * BIRTH messages define alias→name; DATA messages may carry aliases only.
 * Cleared by the "reset" message on disconnect/store reset, and wholesale
 * when the edge cap is hit (same pattern as the service's fingerprint map) —
 * affected metrics fall back to "alias:N" labels until the next BIRTH.
 */
const sparkplugAliasMaps = new Map<string, AliasMap>();

/** Maximum edge nodes with tracked alias maps before a wholesale clear. */
const SPARKPLUG_ALIAS_EDGE_CAP = 500;

/**
 * Sparkplug B detector — matches on topic shape, decodes the protobuf
 * payload when raw bytes were supplied. STATE topics return no result so
 * their JSON payloads fall through to the regular JSON detectors.
 * Note: a match short-circuits the other phases, so a hypothetical JPEG
 * published under spBv1.0/ would not get an image tag — acceptable, the
 * topic explicitly claims the sparkplug protocol.
 */
function detectSparkplug(
  topic: string,
  _payload: string,
  rawBytes: ArrayBuffer | undefined,
): DetectorResult[] {
  const info = parseSparkplugTopic(topic);
  if (!info || info.messageType === "STATE") return [];
  const deviceKey = sparkplugDeviceKey(info);
  if (deviceKey === null) return [];

  let metrics: SparkplugMetric[] = [];
  let seq: number | null = null;
  let payloadTimestamp: number | null = null;

  const decoded = rawBytes ? decodeSparkplugPayload(new Uint8Array(rawBytes)) : null;
  if (decoded) {
    const edgeKey = `${info.groupId}/${info.edgeNodeId}`;
    let aliasMap = sparkplugAliasMaps.get(edgeKey);
    if (!aliasMap) {
      if (sparkplugAliasMaps.size >= SPARKPLUG_ALIAS_EDGE_CAP) {
        sparkplugAliasMaps.clear();
      }
      aliasMap = new Map();
      sparkplugAliasMaps.set(edgeKey, aliasMap);
    }
    if (isBirth(info.messageType)) {
      recordAliases(aliasMap, decoded.metrics);
    }
    resolveAliases(aliasMap, decoded.metrics);
    metrics = decoded.metrics;
    seq = decoded.seq;
    payloadTimestamp = decoded.timestamp;
  }

  const metadata: SparkplugMetadata = {
    deviceKey,
    role: info.deviceId !== null ? "device" : "edge-node",
    messageType: info.messageType,
    // Approximation — the store overrides this with its authoritative
    // lifecycle state when the result lands (setPayloadTags).
    online: !isDeath(info.messageType),
    metricCount: metrics.length,
    metrics,
    seq,
    payloadTimestamp,
  };
  return [{ tag: "sparkplug", confidence: 1, fieldPath: "", metadata }];
}

/** Topic-aware detectors — run first; returning results short-circuits. */
const topicDetectors: Array<
  (topic: string, payload: string, rawBytes: ArrayBuffer | undefined) => DetectorResult[]
> = [detectSparkplug, detectHomeAssistant, detectShelly];

/** Raw-string detectors — run on every payload before JSON parsing. */
const rawDetectors: Array<(payload: string) => DetectorResult[]> = [
  detectImage,
];

/** JSON detectors — run on successfully parsed JSON payloads. */
const jsonDetectors: Array<(parsed: unknown) => DetectorResult[]> = [
  detectGeo,
];

/** Reset hooks — called when the main thread sends a "reset" message. */
const resetHooks: Array<() => void> = [
  () => sparkplugAliasMaps.clear(),
];

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === "reset") {
    for (const hook of resetHooks) hook();
    return;
  }

  if (msg.type === "analyze") {
    const tags: DetectorResult[] = [];

    // Phase 1: topic-aware detectors — a match short-circuits
    for (const detect of topicDetectors) {
      const results = detect(msg.topic, msg.payload, msg.rawBytes);
      if (results.length > 0) {
        tags.push(...results);
        const response: WorkerResponse = { type: "result", nodeId: msg.nodeId, tags };
        self.postMessage(response);
        return;
      }
    }

    // Phase 2: raw-string detectors (always run)
    for (const detect of rawDetectors) {
      const results = detect(msg.payload);
      tags.push(...results);
    }

    // Phase 3: JSON detectors (only if payload is complete and parses as JSON)
    let parsed: unknown;
    try {
      parsed = msg.truncated ? undefined : JSON.parse(msg.payload);
    } catch {
      parsed = undefined; // Not JSON — skip phase 3
    }

    if (parsed !== undefined) {
      for (const detect of jsonDetectors) {
        const results = detect(parsed);
        tags.push(...results);
      }
    }

    const response: WorkerResponse = { type: "result", nodeId: msg.nodeId, tags };
    self.postMessage(response);
  }
};
