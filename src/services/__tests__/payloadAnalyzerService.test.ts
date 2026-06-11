import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Throttle-behaviour tests for the payload analyzer service.
 *
 * The service lazily constructs a Worker; Node has none, so a minimal mock
 * captures postMessage calls. Fake timers drive the throttle windows.
 */

const posts: Array<{ nodeId: string; payload: string }> = [];

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  postMessage(msg: { type: string; nodeId?: string; payload?: string }) {
    if (msg.type === "analyze") {
      posts.push({ nodeId: msg.nodeId!, payload: msg.payload! });
    }
  }
  terminate() {}
}

describe("payloadAnalyzerService throttle", () => {
  // Fresh module per test — the service is a singleton with internal state.
  let payloadAnalyzer: typeof import("../payloadAnalyzerService").payloadAnalyzer;

  beforeEach(async () => {
    posts.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal("Worker", MockWorker);
    vi.resetModules();
    ({ payloadAnalyzer } = await import("../payloadAnalyzerService"));
  });

  afterEach(() => {
    payloadAnalyzer.destroy();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("posts the first payload immediately (leading edge)", () => {
    payloadAnalyzer.analyze("n1", "t", "p1");
    expect(posts).toHaveLength(1);
    expect(posts[0].payload).toBe("p1");
  });

  it("coalesces in-window payloads to one trailing post with the latest payload", () => {
    payloadAnalyzer.analyze("n1", "t", "p1"); // leading
    payloadAnalyzer.analyze("n1", "t", "p2"); // in window — schedules trailing
    payloadAnalyzer.analyze("n1", "t", "p3"); // replaces pending payload
    expect(posts).toHaveLength(1);

    vi.advanceTimersByTime(600);
    expect(posts).toHaveLength(2);
    expect(posts[1].payload).toBe("p3"); // latest won
  });

  it("a fast publisher posts at a steady rate instead of starving", () => {
    // Old restarting debounce: 20 messages at 100ms intervals → ZERO posts
    // until the stream pauses. Throttle: one post per 500ms window.
    for (let i = 0; i < 20; i++) {
      payloadAnalyzer.analyze("n1", "t", `p${i}`);
      vi.advanceTimersByTime(100);
    }
    // 2s of traffic → leading + trailing posts ≈ every 500ms
    expect(posts.length).toBeGreaterThanOrEqual(4);
    expect(posts.length).toBeLessThanOrEqual(6);
  });

  it("throttles per node independently", () => {
    payloadAnalyzer.analyze("n1", "t", "a");
    payloadAnalyzer.analyze("n2", "t", "b");
    expect(posts).toHaveLength(2);
  });

  it("immediate bypasses the throttle and supersedes pending posts", () => {
    payloadAnalyzer.analyze("n1", "t", "p1"); // leading
    payloadAnalyzer.analyze("n1", "t", "p2"); // pending trailing
    payloadAnalyzer.analyze("n1", "t", "p3", { immediate: true });
    expect(posts).toHaveLength(2);
    expect(posts[1].payload).toBe("p3");
    // The superseded trailing post was cancelled
    vi.advanceTimersByTime(1000);
    expect(posts).toHaveLength(2);
  });

  it("identical payloads are skipped by the fingerprint check", () => {
    payloadAnalyzer.analyze("n1", "t", "same");
    vi.advanceTimersByTime(600);
    payloadAnalyzer.analyze("n1", "t", "same"); // unchanged — skipped
    expect(posts).toHaveLength(1);
    payloadAnalyzer.analyze("n1", "t", "different");
    vi.advanceTimersByTime(600);
    expect(posts.length).toBeGreaterThanOrEqual(2);
  });

  it("reset clears pending timers and throttle state", () => {
    payloadAnalyzer.analyze("n1", "t", "p1");
    payloadAnalyzer.analyze("n1", "t", "p2"); // pending
    payloadAnalyzer.reset();
    vi.advanceTimersByTime(1000);
    expect(posts).toHaveLength(1); // pending post was cancelled
  });
});
