import type { AnalyzeRequest, DetectorResult, WorkerResponse } from "../types/payloadTags";
import { prepareAnalysisPayload, fnv1a32 } from "../utils/payloadAnalysis";

type ResultCallback = (nodeId: string, tags: DetectorResult[]) => void;

/** Options for a single analyze() submission. */
export interface AnalyzeOptions {
  /**
   * Raw payload bytes for binary-format detectors. Transferred (zero-copy)
   * to the worker.
   */
  rawBytes?: ArrayBuffer;
  /**
   * Bypass the per-node debounce and post immediately. Used for messages
   * whose ordering matters (e.g. sparkplug BIRTH/DEATH) — coalescing them
   * with a later message would lose lifecycle state in the worker.
   */
  immediate?: boolean;
}

/** Pending debounced submission for one node. */
interface PendingAnalysis {
  timer: ReturnType<typeof setTimeout>;
  topic: string;
  payload: string;
  rawBytes?: ArrayBuffer;
}

/**
 * Service that manages the payload analyzer Web Worker lifecycle.
 *
 * - Lazily creates the worker on first `analyze()` call.
 * - Throttles analysis per node ID (max one post per THROTTLE_MS, leading +
 *   trailing edge), unless `immediate`. NOTE: this is a throttle, not a
 *   restarting debounce — a topic publishing faster than the window still
 *   produces a steady stream of analyses (latest payload wins). The old
 *   restarting debounce starved fast publishers entirely, which froze
 *   "latest value" displays and would have made metric history impossible.
 * - Skips re-analysis when a node's payload is unchanged since the last
 *   submission (length + FNV-1a fingerprint).
 * - Routes worker results back to a registered callback (typically the store).
 * - Terminates the worker on `destroy()`.
 */
class PayloadAnalyzerService {
  private worker: Worker | null = null;
  private callback: ResultCallback | null = null;

  /**
   * Map of nodeId -> pending trailing-edge submission. While a node is inside
   * its throttle window, new payloads REPLACE the pending one (latest wins)
   * without extending the timer.
   */
  private pending = new Map<string, PendingAnalysis>();

  /**
   * Map of nodeId -> wall-clock ms of the last post to the worker.
   * Capped alongside lastFingerprint to bound memory on huge topic trees.
   */
  private lastPostTime = new Map<string, number>();

  /**
   * Map of nodeId -> fingerprint of the last payload actually posted.
   * Packed as `length * 2^32 + fnv1a32` in a float — exact for payloads
   * under ANALYSIS_MAX_CHARS. Capped to bound memory on huge topic trees.
   */
  private lastFingerprint = new Map<string, number>();

  /** Throttle window in milliseconds (max one post per node per window). */
  private readonly THROTTLE_MS = 500;

  /** Maximum fingerprint entries before the map is cleared wholesale. */
  private readonly FINGERPRINT_CAP = 2000;

  /** Register a callback that receives analysis results from the worker. */
  onResult(cb: ResultCallback): void {
    this.callback = cb;
  }

  /**
   * Submit a payload for analysis. Throttled per nodeId: the first payload
   * in a window posts immediately (leading edge); payloads arriving inside
   * the window replace the pending trailing-edge submission (latest wins)
   * WITHOUT extending the timer, so fast publishers post at a steady
   * 1/THROTTLE_MS rate instead of starving. `opts.immediate` bypasses the
   * throttle (and supersedes any pending submission for the node).
   */
  analyze(nodeId: string, topic: string, payload: string, opts?: AnalyzeOptions): void {
    if (opts?.immediate) {
      const existing = this.pending.get(nodeId);
      if (existing !== undefined) {
        clearTimeout(existing.timer);
        this.pending.delete(nodeId);
      }
      this.post(nodeId, topic, payload, opts.rawBytes);
      return;
    }

    // Inside the window with a trailing post already scheduled — replace its
    // payload (latest wins) and let the existing timer deliver it.
    const existing = this.pending.get(nodeId);
    if (existing !== undefined) {
      existing.topic = topic;
      existing.payload = payload;
      existing.rawBytes = opts?.rawBytes;
      return;
    }

    const elapsed = Date.now() - (this.lastPostTime.get(nodeId) ?? 0);
    if (elapsed >= this.THROTTLE_MS) {
      // Leading edge — post immediately
      this.post(nodeId, topic, payload, opts?.rawBytes);
      return;
    }

    // Schedule the trailing edge for the remainder of the window
    const timer = setTimeout(() => {
      const p = this.pending.get(nodeId);
      this.pending.delete(nodeId);
      if (p) this.post(nodeId, p.topic, p.payload, p.rawBytes);
    }, this.THROTTLE_MS - elapsed);

    this.pending.set(nodeId, { timer, topic, payload, rawBytes: opts?.rawBytes });
  }

  /** Clear all analysis state (pending timers, fingerprints, worker state). */
  reset(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
    }
    this.pending.clear();
    this.lastFingerprint.clear();
    this.lastPostTime.clear();
    this.worker?.postMessage({ type: "reset" });
  }

  /** Terminate the worker and clear all pending timers. */
  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
    }
    this.pending.clear();
    this.lastFingerprint.clear();
    this.lastPostTime.clear();
    this.callback = null;
  }

  /** Record the post time for throttle accounting, then post to the worker. */
  private post(nodeId: string, topic: string, payload: string, rawBytes?: ArrayBuffer): void {
    if (this.lastPostTime.size >= this.FINGERPRINT_CAP) {
      this.lastPostTime.clear();
    }
    this.lastPostTime.set(nodeId, Date.now());
    this.postToWorker(nodeId, topic, payload, rawBytes);
  }

  // --- Private ---

  /**
   * Lazily create the worker if it doesn't exist yet. Returns null in
   * environments without Worker support (unit tests) — analysis is then
   * silently skipped.
   */
  private ensureWorker(): Worker | null {
    if (typeof Worker === "undefined") return null;
    if (!this.worker) {
      this.worker = new Worker(
        new URL("../workers/payloadAnalyzer.worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleWorkerMessage(event.data);
      };
      this.worker.onerror = (err) => {
        console.error("[PayloadAnalyzer] Worker error:", err);
      };
    }
    return this.worker;
  }

  /** Post an analyze request to the worker (with identical-payload skip). */
  private postToWorker(
    nodeId: string,
    topic: string,
    payload: string,
    rawBytes?: ArrayBuffer,
  ): void {
    const { slice, truncated } = prepareAnalysisPayload(payload);

    // Skip if this node's payload is unchanged since the last post.
    // rawBytes submissions are never skipped — the string view of a binary
    // payload can collide even when the bytes differ (U+FFFD mangling).
    const fingerprint = slice.length * 0x100000000 + fnv1a32(slice);
    if (rawBytes === undefined && this.lastFingerprint.get(nodeId) === fingerprint) {
      return;
    }
    if (this.lastFingerprint.size >= this.FINGERPRINT_CAP) {
      this.lastFingerprint.clear();
    }
    this.lastFingerprint.set(nodeId, fingerprint);

    const worker = this.ensureWorker();
    if (!worker) return;
    const msg: AnalyzeRequest = { type: "analyze", nodeId, topic, payload: slice, truncated };
    if (rawBytes) {
      msg.rawBytes = rawBytes;
      worker.postMessage(msg, [rawBytes]);
    } else {
      worker.postMessage(msg);
    }
  }

  /** Handle a response from the worker. */
  private handleWorkerMessage(msg: WorkerResponse): void {
    if (msg.type === "result" && this.callback) {
      this.callback(msg.nodeId, msg.tags);
    }
  }
}

/** Singleton instance. */
export const payloadAnalyzer = new PayloadAnalyzerService();
