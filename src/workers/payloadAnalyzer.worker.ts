import type { WorkerRequest, WorkerResponse, DetectorResult } from "../types/payloadTags";
import { detectGeo } from "../utils/detectors/geoDetector";

/**
 * Payload Analyzer Web Worker
 *
 * Runs detector functions off the main thread. Receives payloads as strings,
 * parses them as JSON, runs all registered detectors, and posts back results.
 * Non-JSON payloads are silently skipped (empty result set).
 */

/** All registered detector functions. Add new detectors here. */
const detectors: Array<(parsed: unknown) => DetectorResult[]> = [
  detectGeo,
];

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === "analyze") {
    const tags: DetectorResult[] = [];

    // Try to parse as JSON — non-JSON payloads produce no tags
    let parsed: unknown;
    try {
      parsed = JSON.parse(msg.payload);
    } catch {
      // Not JSON — skip analysis
      const response: WorkerResponse = { type: "result", nodeId: msg.nodeId, tags: [] };
      self.postMessage(response);
      return;
    }

    // Run all registered detectors
    for (const detect of detectors) {
      const results = detect(parsed);
      tags.push(...results);
    }

    const response: WorkerResponse = { type: "result", nodeId: msg.nodeId, tags };
    self.postMessage(response);
  }
};
