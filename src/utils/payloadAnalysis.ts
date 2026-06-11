/**
 * Pure helpers for the payload analysis pipeline (main-thread side).
 */

/**
 * Maximum characters of payload sent to the analyzer worker.
 *
 * Image detection needs only the first ~20 chars; real-world structured
 * payloads (geo JSON etc.) are well under 4 KB, so 64 KB gives generous
 * headroom while bounding the per-message structured-clone cost for
 * outliers (e.g. a camera publishing 500 KB JPEGs at 10 Hz would
 * otherwise copy ~5 MB/s into the worker).
 */
export const ANALYSIS_MAX_CHARS = 65_536;

/**
 * Slice a payload for worker analysis. `truncated` tells the worker to
 * skip JSON detectors — a truncated JSON document cannot parse anyway.
 */
export function prepareAnalysisPayload(payload: string): {
  slice: string;
  truncated: boolean;
} {
  if (payload.length <= ANALYSIS_MAX_CHARS) {
    return { slice: payload, truncated: false };
  }
  return { slice: payload.slice(0, ANALYSIS_MAX_CHARS), truncated: true };
}

/**
 * FNV-1a 32-bit hash. Used to fingerprint payloads so identical repeats
 * skip re-analysis. Not cryptographic — collisions are tolerable here
 * (consequence is a stale tag, and length is checked alongside the hash).
 */
export function fnv1a32(s: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (hash * 16777619)
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash;
}
