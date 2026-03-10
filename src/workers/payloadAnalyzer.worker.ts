import type { WorkerRequest, WorkerResponse, DetectorResult } from "../types/payloadTags";
import { detectGeo } from "../utils/detectors/geoDetector";
import { detectImage } from "../utils/detectors/imageDetector";

/**
 * Payload Analyzer Web Worker
 *
 * Runs detector functions off the main thread.  Two detector phases:
 *
 * 1. **Raw-string detectors** — operate on the raw payload string before
 *    JSON parsing.  Used for binary format detection (e.g. JPEG, PNG)
 *    where the payload is not valid JSON.
 *
 * 2. **JSON detectors** — operate on the parsed JSON object.  Used for
 *    structured data detection (e.g. geo coordinates).
 *
 * Non-JSON payloads skip phase 2 but still run phase 1.
 */

/** Raw-string detectors — run on every payload before JSON parsing. */
const rawDetectors: Array<(payload: string) => DetectorResult[]> = [
  detectImage,
];

/** JSON detectors — run on successfully parsed JSON payloads. */
const jsonDetectors: Array<(parsed: unknown) => DetectorResult[]> = [
  detectGeo,
];

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === "analyze") {
    const tags: DetectorResult[] = [];

    // Phase 1: raw-string detectors (always run)
    for (const detect of rawDetectors) {
      const results = detect(msg.payload);
      tags.push(...results);
    }

    // Phase 2: JSON detectors (only if payload parses as JSON)
    let parsed: unknown;
    try {
      parsed = JSON.parse(msg.payload);
    } catch {
      // Not JSON — skip phase 2
      const response: WorkerResponse = { type: "result", nodeId: msg.nodeId, tags };
      self.postMessage(response);
      return;
    }

    for (const detect of jsonDetectors) {
      const results = detect(parsed);
      tags.push(...results);
    }

    const response: WorkerResponse = { type: "result", nodeId: msg.nodeId, tags };
    self.postMessage(response);
  }
};
