/**
 * Performance debug module. Activated by `?perf` URL param or `localStorage.perfDebug === '1'`.
 *
 * When enabled:
 * - Wraps hot paths with `performance.mark/measure` for DevTools User Timing
 * - Observes `long-animation-frame` and `longtask` for automatic jank detection
 * - Provides helpers for FPS counting and periodic summary logging
 *
 * When disabled: all exports are no-ops or constants — zero runtime cost.
 */

/** Whether perf debug mode is active. Check this before any instrumentation work. */
export const PERF_ENABLED: boolean = (() => {
  try {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).has("perf")) return true;
    if (localStorage.getItem("perfDebug") === "1") return true;
  } catch {
    // SSR or restricted environment
  }
  return false;
})();

/**
 * Thin wrapper around `performance.mark()`. No-ops when perf debug is off.
 */
export function perfMark(name: string): void {
  if (!PERF_ENABLED) return;
  performance.mark(name);
}

/**
 * Thin wrapper around `performance.measure()`. No-ops when perf debug is off.
 * Returns the duration in ms, or 0 if disabled.
 */
export function perfMeasure(name: string, startMark: string, endMark: string): number {
  if (!PERF_ENABLED) return 0;
  try {
    const m = performance.measure(name, startMark, endMark);
    return m.duration;
  } catch {
    return 0;
  }
}

/**
 * Shared stats written by store instrumentation, read by the renderer for summaries.
 * Module-level singleton avoids coupling the store and renderer directly.
 */
export const perfStats = {
  lastDecayTickMs: 0,
};

/**
 * Rolling average tracker for perf measurements.
 * Keeps the last N samples and computes the mean on demand.
 */
export class RollingAvg {
  private samples: number[] = [];
  private idx = 0;
  private full = false;

  constructor(private capacity: number) {
    this.samples = new Array(capacity).fill(0);
  }

  push(value: number): void {
    this.samples[this.idx] = value;
    this.idx = (this.idx + 1) % this.capacity;
    if (this.idx === 0) this.full = true;
  }

  avg(): number {
    const count = this.full ? this.capacity : this.idx;
    if (count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < count; i++) sum += this.samples[i];
    return sum / count;
  }
}

/** Heap memory info (Chrome only). Returns null on unsupported browsers. */
export function getHeapMB(): number | null {
  try {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    if (mem) return +(mem.usedJSHeapSize / 1048576).toFixed(1);
  } catch {
    // Not available
  }
  return null;
}

/**
 * Log a periodic performance summary to the console.
 * All values are rounded for readability.
 */
export function logPerfSummary(stats: Record<string, number | null>): void {
  // eslint-disable-next-line no-console
  console.log("[PERF:SUMMARY]", JSON.stringify(stats));
}

/**
 * Initialise PerformanceObserver for long frames and long tasks.
 * Call once at startup when PERF_ENABLED is true.
 */
export function initPerfObserver(): void {
  if (!PERF_ENABLED) return;

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const data: Record<string, unknown> = {
        type: entry.entryType,
        duration: +entry.duration.toFixed(1),
      };

      // Long Animation Frame entries (Chromium 123+) have extra detail
      const loaf = entry as unknown as {
        blockingDuration?: number;
        renderStart?: number;
        styleAndLayoutStart?: number;
        scripts?: Array<{
          invoker: string;
          duration: number;
          sourceURL: string;
          sourceFunctionName: string;
        }>;
      };
      if (loaf.blockingDuration !== undefined) {
        data.blockingDuration = +loaf.blockingDuration.toFixed(1);
      }
      if (loaf.scripts && loaf.scripts.length > 0) {
        data.scripts = loaf.scripts.map((s) => ({
          invoker: s.invoker,
          fn: s.sourceFunctionName,
          duration: +s.duration.toFixed(1),
          src: s.sourceURL.split("/").pop() ?? s.sourceURL,
        }));
      }

      // eslint-disable-next-line no-console
      console.log("[PERF:LONG_FRAME]", JSON.stringify(data));
    }
  });

  // Observe what's available — gracefully skip unsupported types
  for (const type of ["long-animation-frame", "longtask"]) {
    try {
      observer.observe({ type, buffered: true });
    } catch {
      // Type not supported in this browser
    }
  }
}
