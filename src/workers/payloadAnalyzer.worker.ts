import type { WorkerRequest, WorkerResponse, DetectorResult } from "../types/payloadTags";
import { detectGeo } from "../utils/detectors/geoDetector";
import { detectImage } from "../utils/detectors/imageDetector";

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

/** Topic-aware detectors — run first; returning results short-circuits. */
const topicDetectors: Array<
  (topic: string, payload: string, rawBytes: ArrayBuffer | undefined) => DetectorResult[]
> = [];

/** Raw-string detectors — run on every payload before JSON parsing. */
const rawDetectors: Array<(payload: string) => DetectorResult[]> = [
  detectImage,
];

/** JSON detectors — run on successfully parsed JSON payloads. */
const jsonDetectors: Array<(parsed: unknown) => DetectorResult[]> = [
  detectGeo,
];

/** Reset hooks — called when the main thread sends a "reset" message. */
const resetHooks: Array<() => void> = [];

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
