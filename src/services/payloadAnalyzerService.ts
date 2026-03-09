import type { AnalyzeRequest, DetectorResult, WorkerResponse } from "../types/payloadTags";

type ResultCallback = (nodeId: string, tags: DetectorResult[]) => void;

/**
 * Service that manages the payload analyzer Web Worker lifecycle.
 *
 * - Lazily creates the worker on first `analyze()` call.
 * - Debounces analysis requests per node ID (500ms).
 * - Routes worker results back to a registered callback (typically the store).
 * - Terminates the worker on `destroy()`.
 */
class PayloadAnalyzerService {
  private worker: Worker | null = null;
  private callback: ResultCallback | null = null;

  /**
   * Map of nodeId -> debounce timer.  Prevents flooding the worker when the
   * same node receives many messages in quick succession.
   */
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Debounce window in milliseconds. */
  private readonly DEBOUNCE_MS = 500;

  /** Register a callback that receives analysis results from the worker. */
  onResult(cb: ResultCallback): void {
    this.callback = cb;
  }

  /**
   * Submit a payload for analysis.  The request is debounced per nodeId —
   * if the same node is submitted again within DEBOUNCE_MS, the earlier
   * request is cancelled and replaced.
   */
  analyze(nodeId: string, payload: string): void {
    // Clear any pending debounce for this node
    const existing = this.debounceTimers.get(nodeId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(nodeId);
      this.postToWorker(nodeId, payload);
    }, this.DEBOUNCE_MS);

    this.debounceTimers.set(nodeId, timer);
  }

  /** Terminate the worker and clear all pending timers. */
  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.callback = null;
  }

  // --- Private ---

  /** Lazily create the worker if it doesn't exist yet. */
  private ensureWorker(): Worker {
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

  /** Post an analyze request to the worker. */
  private postToWorker(nodeId: string, payload: string): void {
    const worker = this.ensureWorker();
    const msg: AnalyzeRequest = { type: "analyze", nodeId, payload };
    worker.postMessage(msg);
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
