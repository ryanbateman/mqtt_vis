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
 * - Debounces analysis requests per node ID (500ms), unless `immediate`.
 * - Skips re-analysis when a node's payload is unchanged since the last
 *   submission (length + FNV-1a fingerprint).
 * - Routes worker results back to a registered callback (typically the store).
 * - Terminates the worker on `destroy()`.
 */
class PayloadAnalyzerService {
  private worker: Worker | null = null;
  private callback: ResultCallback | null = null;

  /**
   * Map of nodeId -> pending debounced submission. Prevents flooding the
   * worker when the same node receives many messages in quick succession;
   * the latest payload always wins.
   */
  private pending = new Map<string, PendingAnalysis>();

  /**
   * Map of nodeId -> fingerprint of the last payload actually posted.
   * Packed as `length * 2^32 + fnv1a32` in a float — exact for payloads
   * under ANALYSIS_MAX_CHARS. Capped to bound memory on huge topic trees.
   */
  private lastFingerprint = new Map<string, number>();

  /** Debounce window in milliseconds. */
  private readonly DEBOUNCE_MS = 500;

  /** Maximum fingerprint entries before the map is cleared wholesale. */
  private readonly FINGERPRINT_CAP = 2000;

  /** Register a callback that receives analysis results from the worker. */
  onResult(cb: ResultCallback): void {
    this.callback = cb;
  }

  /**
   * Submit a payload for analysis. Debounced per nodeId — if the same node
   * is submitted again within DEBOUNCE_MS, the earlier request is cancelled
   * and replaced. `opts.immediate` bypasses the debounce (and flushes any
   * pending submission for the node, which the immediate payload supersedes).
   */
  analyze(nodeId: string, topic: string, payload: string, opts?: AnalyzeOptions): void {
    // Clear any pending debounce for this node
    const existing = this.pending.get(nodeId);
    if (existing !== undefined) {
      clearTimeout(existing.timer);
      this.pending.delete(nodeId);
    }

    if (opts?.immediate) {
      this.postToWorker(nodeId, topic, payload, opts.rawBytes);
      return;
    }

    const timer = setTimeout(() => {
      this.pending.delete(nodeId);
      this.postToWorker(nodeId, topic, payload, opts?.rawBytes);
    }, this.DEBOUNCE_MS);

    this.pending.set(nodeId, { timer, topic, payload, rawBytes: opts?.rawBytes });
  }

  /** Clear all analysis state (pending timers, fingerprints, worker state). */
  reset(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
    }
    this.pending.clear();
    this.lastFingerprint.clear();
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
    this.callback = null;
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
