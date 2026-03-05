import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useTopicStore } from "../topicStore";
import { MIN_RADIUS } from "../../utils/sizeCalculator";
import {
  persistSettings,
  clearSavedSettings,
  loadSavedSettings,
} from "../../utils/settingsStorage";

// Polyfill requestAnimationFrame / cancelAnimationFrame for the Node.js test environment.
// scheduleRebuild uses rAF to batch graph rebuilds. In tests, we simulate the
// deferred rebuild by calling state().rebuildGraph() synchronously where needed.
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(cb, 0)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
}

/**
 * Helper: get the store's current state.
 */
function state() {
  return useTopicStore.getState();
}

/**
 * Helper: call handleMessage and immediately flush the batched rebuild.
 * In production, the rebuild is deferred via requestAnimationFrame.
 * In tests, we force a synchronous rebuild for deterministic assertions.
 */
function handleMessageAndFlush(topic: string, payload: string, qos: 0 | 1 | 2 = 0) {
  state().handleMessage(topic, payload, qos);
  state().rebuildGraph();
}

/**
 * Helper: find a GraphNode by id from the current store state.
 */
function findGraphNode(id: string) {
  return state().graphNodes.find((n) => n.id === id);
}

/**
 * Helper: find a TopicNode by walking the tree from root.
 */
function findTopicNode(path: string) {
  const root = state().root;
  if (path === "") return root;
  const segments = path.split("/");
  let current = root;
  for (const seg of segments) {
    const child = current.children.get(seg);
    if (!child) return undefined;
    current = child;
  }
  return current;
}

describe("topicStore — ancestor pulse data flow", () => {
  beforeEach(() => {
    // Reset the store to a clean state before each test
    state().reset();
    // Ensure ancestor pulse is enabled (default)
    state().setAncestorPulse(true);
    state().setShowRootPath(true);
    state().setTopicFilter("#");
  });

  describe("pulseRate on direct message", () => {
    it("should set pulseRate on the leaf TopicNode when a message is received", () => {
      handleMessageAndFlush("a/b/c", "hello");

      const leaf = findTopicNode("a/b/c");
      expect(leaf).toBeDefined();
      expect(leaf!.pulseRate).toBeGreaterThan(0);
      // pulseRate should equal the messageRate spike (1 for the first message)
      expect(leaf!.pulseRate).toBe(1);
    });

    it("should accumulate pulseRate on repeated messages to same topic", () => {
      handleMessageAndFlush("a/b/c", "msg1");
      handleMessageAndFlush("a/b/c", "msg2");

      const leaf = findTopicNode("a/b/c");
      expect(leaf).toBeDefined();
      // messageRate is 2 (two spikes), pulseRate should be 2
      expect(leaf!.pulseRate).toBe(2);
      expect(leaf!.messageRate).toBe(2);
    });

    it("should set pulseTimestamp on the leaf TopicNode", () => {
      const before = Date.now();
      handleMessageAndFlush("a/b/c", "hello");
      const after = Date.now();

      const leaf = findTopicNode("a/b/c");
      expect(leaf).toBeDefined();
      expect(leaf!.lastTimestamp).toBeGreaterThanOrEqual(before);
      expect(leaf!.lastTimestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("ancestor pulse propagation", () => {
    it("should set lastTimestamp on all ancestors when ancestorPulse is enabled", () => {
      const before = Date.now();
      state().handleMessage("a/b/c", "hello", 0);
      const after = Date.now();

      // Check each ancestor
      for (const path of ["a/b", "a", ""]) {
        const ancestor = findTopicNode(path);
        expect(ancestor).toBeDefined();
        expect(ancestor!.lastTimestamp).toBeGreaterThanOrEqual(before);
        expect(ancestor!.lastTimestamp).toBeLessThanOrEqual(after);
      }
    });

    it("should set pulseRate >= 1 on all ancestors", () => {
      state().handleMessage("a/b/c", "hello", 0);

      for (const path of ["a/b", "a", ""]) {
        const ancestor = findTopicNode(path);
        expect(ancestor).toBeDefined();
        expect(ancestor!.pulseRate).toBeGreaterThanOrEqual(1);
      }
    });

    it("should NOT set lastTimestamp on ancestors when ancestorPulse is disabled", () => {
      state().setAncestorPulse(false);
      state().handleMessage("a/b/c", "hello", 0);

      // Ancestors should still have lastTimestamp = 0 (never pulsed)
      for (const path of ["a/b", "a"]) {
        const ancestor = findTopicNode(path);
        expect(ancestor).toBeDefined();
        expect(ancestor!.lastTimestamp).toBe(0);
      }
    });

    it("should NOT set pulseRate on ancestors when ancestorPulse is disabled", () => {
      state().setAncestorPulse(false);
      state().handleMessage("a/b/c", "hello", 0);

      for (const path of ["a/b", "a"]) {
        const ancestor = findTopicNode(path);
        expect(ancestor).toBeDefined();
        expect(ancestor!.pulseRate).toBe(0);
      }
    });
  });

  describe("pulseRate persists through decay", () => {
    it("should preserve pulseRate after multiple decay ticks while messageRate decays", () => {
      state().handleMessage("a/b/c", "hello", 0);

      const leaf = findTopicNode("a/b/c");
      const initialPulseRate = leaf!.pulseRate;
      expect(initialPulseRate).toBe(1);

      // Run several decay ticks
      for (let i = 0; i < 10; i++) {
        state().decayTick();
      }

      // pulseRate should be unchanged — it's a snapshot, not decayed
      expect(leaf!.pulseRate).toBe(initialPulseRate);

      // messageRate should have decayed significantly
      expect(leaf!.messageRate).toBeLessThan(initialPulseRate);
    });

    it("should preserve ancestor pulseRate after multiple decay ticks", () => {
      state().handleMessage("a/b/c", "hello", 0);

      const ancestor = findTopicNode("a");
      const initialPulseRate = ancestor!.pulseRate;
      expect(initialPulseRate).toBeGreaterThanOrEqual(1);

      // Run several decay ticks
      for (let i = 0; i < 10; i++) {
        state().decayTick();
      }

      // Ancestor pulseRate should be unchanged
      expect(ancestor!.pulseRate).toBe(initialPulseRate);
    });
  });

  describe("GraphNode pulse data in buildGraphData", () => {
    it("should pass pulseRate through to GraphNode immediately after handleMessage", () => {
      handleMessageAndFlush("a/b/c", "hello");

      const gn = findGraphNode("a/b/c");
      expect(gn).toBeDefined();
      expect(gn!.pulseRate).toBe(1);
    });

    it("should pass ancestor pulseRate through to ancestor GraphNodes", () => {
      handleMessageAndFlush("a/b/c", "hello");

      for (const id of ["a/b", "a", ""]) {
        const gn = findGraphNode(id);
        expect(gn).toBeDefined();
        expect(gn!.pulseRate).toBeGreaterThanOrEqual(1);
      }
    });

    it("should have pulse=true on ancestors within pulseDuration window", () => {
      handleMessageAndFlush("a/b/c", "hello");

      for (const id of ["a/b", "a"]) {
        const gn = findGraphNode(id);
        expect(gn).toBeDefined();
        expect(gn!.pulse).toBe(true);
        expect(gn!.pulseTimestamp).toBeGreaterThan(0);
      }
    });

    it("should have pulse=false on ancestors after pulseDuration expires", () => {
      // Use a short fake timestamp to simulate an old pulse
      state().handleMessage("a/b/c", "hello", 0);
      state().rebuildGraph(); // flush the structural rebuild so graphNodes exist before decayTick

      // Manually set lastTimestamp to far in the past
      const leaf = findTopicNode("a/b/c");
      const oldTime = Date.now() - 100_000; // 100 seconds ago
      leaf!.lastTimestamp = oldTime;
      // Also set ancestors to the same old time
      for (const path of ["a/b", "a", ""]) {
        const ancestor = findTopicNode(path);
        if (ancestor) ancestor.lastTimestamp = oldTime;
      }

      state().decayTick();

      // pulse should be false (pulseDuration at default tau=5 is 5000ms, and 100s >> 5s)
      for (const id of ["a/b/c", "a/b", "a"]) {
        const gn = findGraphNode(id);
        expect(gn).toBeDefined();
        expect(gn!.pulse).toBe(false);
      }

      // But pulseRate should still be preserved (snapshot, not cleared)
      const gnLeaf = findGraphNode("a/b/c");
      expect(gnLeaf!.pulseRate).toBe(1);
    });

    it("ancestor GraphNodes should have pulseRate > 0 even after rate decays to zero", () => {
      state().handleMessage("a/b/c", "hello", 0);
      state().rebuildGraph(); // flush the structural rebuild so graphNodes exist before decayTick

      // Run many decay ticks to drive messageRate and aggregateRate toward zero
      for (let i = 0; i < 50; i++) {
        state().decayTick();
      }

      // Check that messageRate has decayed to ~0
      const leaf = findTopicNode("a/b/c");
      expect(leaf!.messageRate).toBeLessThan(0.01);

      // But GraphNode pulseRate should still be the snapshot value
      const gnLeaf = findGraphNode("a/b/c");
      expect(gnLeaf).toBeDefined();
      expect(gnLeaf!.pulseRate).toBe(1);

      // Ancestor GraphNodes should also retain their pulseRate
      for (const id of ["a/b", "a"]) {
        const gn = findGraphNode(id);
        expect(gn).toBeDefined();
        expect(gn!.pulseRate).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe("fade interpolation correctness", () => {
    it("pulseDuration should equal emaTau * 1000", () => {
      // The fade window is emaTau in milliseconds.
      // "Fade Time = 5s" means a 5000ms fade window.
      const emaTau = state().emaTau; // default 5
      const fadeDuration = emaTau * 1000;
      expect(fadeDuration).toBe(5000);
    });

    /**
     * This test validates the core invariant the renderer depends on:
     * Within the fade window, age/fadeDuration yields t in [0, 1),
     * and pulseRate provides a meaningful warm colour value (> 0).
     * After the fade window, t >= 1 and the renderer falls back to messageRate.
     */
    it("should provide correct data for renderer fade interpolation", () => {
      const emaTau = state().emaTau;
      const fadeDuration = emaTau * 1000;

      handleMessageAndFlush("a/b/c", "hello");

      const now = Date.now();

      // Check leaf node — flush ensures rebuildGraph ran synchronously
      const gnLeaf = findGraphNode("a/b/c");
      expect(gnLeaf).toBeDefined();

      const leafAge = now - gnLeaf!.pulseTimestamp;
      const leafT = Math.min(leafAge / fadeDuration, 1);

      // Just happened — should be within fade window
      expect(leafT).toBeLessThan(1);
      // pulseRate should be positive for a warm colour
      expect(gnLeaf!.pulseRate).toBeGreaterThan(0);

      // Check an ancestor
      const gnAncestor = findGraphNode("a");
      expect(gnAncestor).toBeDefined();

      const ancestorAge = now - gnAncestor!.pulseTimestamp;
      const ancestorT = Math.min(ancestorAge / fadeDuration, 1);

      // Should also be within fade window
      expect(ancestorT).toBeLessThan(1);
      // pulseRate should be >= 1 for a visible warm colour
      expect(gnAncestor!.pulseRate).toBeGreaterThanOrEqual(1);
    });

    it("should use rateToColor(pulseRate) for warm end and rateToColor(messageRate) for idle end", () => {
      // This is a structural test — we verify the data shapes that the renderer expects.
      // The renderer does: d3.interpolateRgb(rateToColor(d.pulseRate), rateToColor(d.messageRate))(t)
      // For ancestors: messageRate is ~0 (idle grey), pulseRate >= 1 (warm colour).
      // This ensures a visible colour transition rather than grey-to-grey.
      state().handleMessage("a/b/c", "hello", 0);
      state().rebuildGraph(); // flush the structural rebuild so graphNodes exist before decayTick

      // Run a few ticks so messageRate starts decaying
      for (let i = 0; i < 3; i++) {
        state().decayTick();
      }

      const gnAncestor = findGraphNode("a");
      expect(gnAncestor).toBeDefined();

      // Ancestor never received a direct message — its messageRate should be 0
      expect(gnAncestor!.messageRate).toBe(0);

      // But its pulseRate should be >= 1 — this is the critical invariant
      // that makes the fade visible (warm-to-grey, not grey-to-grey)
      expect(gnAncestor!.pulseRate).toBeGreaterThanOrEqual(1);
    });
  });

  describe("graph rebuild produces correct data", () => {
    it("should produce graphNodes after handleMessage + rebuildGraph", () => {
      // Before any message, graphNodes has only the root (from setShowRootPath(true) in beforeEach)
      const initialCount = state().graphNodes.length;

      handleMessageAndFlush("a/b/c", "hello");

      // After flush, graphNodes should include the new topic path
      // (root + a + a/b + a/b/c = 4 nodes)
      expect(state().graphNodes.length).toBeGreaterThanOrEqual(initialCount + 3);

      // The leaf should have pulse=true and a recent pulseTimestamp
      const gnLeaf = findGraphNode("a/b/c");
      expect(gnLeaf).toBeDefined();
      expect(gnLeaf!.pulse).toBe(true);
      expect(gnLeaf!.pulseTimestamp).toBeGreaterThan(Date.now() - 1000);
    });
  });

  describe("link pulse — only ancestor chain links", () => {
    /**
     * Helper: find a GraphLink by source and target ids.
     * After D3 processing, source/target may be objects, but in the store
     * they're still strings (before the renderer processes them).
     */
    function findGraphLink(sourceId: string, targetId: string) {
      return state().graphLinks.find((l) => {
        const src = typeof l.source === "string" ? l.source : (l.source as { id: string }).id;
        const tgt = typeof l.target === "string" ? l.target : (l.target as { id: string }).id;
        return src === sourceId && tgt === targetId;
      });
    }

    it("should pulse links on the ancestor chain of the message target", () => {
      // Create a sibling branch first
      handleMessageAndFlush("a/other", "setup");
      // Clear sibling's pulse timestamp so it's not pulsing
      const sibling = findTopicNode("a/other");
      sibling!.lastTimestamp = 0;

      // Now send the real message
      handleMessageAndFlush("a/b/c", "hello");

      // Links on the ancestor chain should pulse:
      //   root("") → a, a → a/b, a/b → a/b/c
      const linkRootToA = findGraphLink("", "a");
      expect(linkRootToA).toBeDefined();
      expect(linkRootToA!.pulse).toBe(true);

      const linkAToAB = findGraphLink("a", "a/b");
      expect(linkAToAB).toBeDefined();
      expect(linkAToAB!.pulse).toBe(true);

      const linkABToABC = findGraphLink("a/b", "a/b/c");
      expect(linkABToABC).toBeDefined();
      expect(linkABToABC!.pulse).toBe(true);
    });

    it("should NOT pulse links to sibling branches", () => {
      // Create a sibling branch first
      handleMessageAndFlush("a/other", "setup");
      // Clear sibling's pulse timestamp so it's not pulsing
      const sibling = findTopicNode("a/other");
      sibling!.lastTimestamp = 0;

      // Now send the real message on a different branch
      handleMessageAndFlush("a/b/c", "hello");

      // The link a → a/other should NOT pulse because a/other is not pulsing
      const linkAToOther = findGraphLink("a", "a/other");
      expect(linkAToOther).toBeDefined();
      expect(linkAToOther!.pulse).toBe(false);
    });

    it("should not pulse any links when ancestorPulse is disabled (except leaf's parent link)", () => {
      state().setAncestorPulse(false);

      // Create structure
      handleMessageAndFlush("a/other", "setup");
      const sibling = findTopicNode("a/other");
      sibling!.lastTimestamp = 0;

      handleMessageAndFlush("a/b/c", "hello");

      // Only the leaf node itself is pulsing, ancestors are not.
      // With AND logic, a link needs BOTH endpoints pulsing.
      // root → a: root not pulsing, a not pulsing → no pulse
      const linkRootToA = findGraphLink("", "a");
      expect(linkRootToA).toBeDefined();
      expect(linkRootToA!.pulse).toBe(false);

      // a → a/b: a not pulsing, a/b not pulsing → no pulse
      const linkAToAB = findGraphLink("a", "a/b");
      expect(linkAToAB).toBeDefined();
      expect(linkAToAB!.pulse).toBe(false);

      // a/b → a/b/c: a/b not pulsing, a/b/c is pulsing → no pulse (AND requires both)
      const linkABToABC = findGraphLink("a/b", "a/b/c");
      expect(linkABToABC).toBeDefined();
      expect(linkABToABC!.pulse).toBe(false);
    });
  });

  describe("parent node sizing with ancestorPulse toggle", () => {
    it("should keep parent nodes at MIN_RADIUS when ancestorPulse is off", () => {
      state().setAncestorPulse(false);
      handleMessageAndFlush("a/b/c", "hello");

      // Parent nodes never received a direct message — messageRate is 0
      // With ancestorPulse off, radius uses messageRate, not aggregateRate
      for (const id of ["a/b", "a"]) {
        const gn = findGraphNode(id);
        expect(gn).toBeDefined();
        expect(gn!.radius).toBe(MIN_RADIUS);
      }

      // The leaf node itself should be larger (it received a direct message)
      const gnLeaf = findGraphNode("a/b/c");
      expect(gnLeaf).toBeDefined();
      expect(gnLeaf!.radius).toBeGreaterThan(MIN_RADIUS);
    });

    it("should grow parent nodes based on subtree activity when ancestorPulse is on", () => {
      state().setAncestorPulse(true);
      state().handleMessage("a/b/c", "hello", 0);
      state().rebuildGraph(); // flush the structural rebuild so graphNodes exist before decayTick

      // decayTick propagates aggregateRate bottom-up, then rebuilds graph
      state().decayTick();

      // With ancestorPulse on, radius uses aggregateRate — parents grow
      for (const id of ["a/b", "a"]) {
        const gn = findGraphNode(id);
        expect(gn).toBeDefined();
        expect(gn!.radius).toBeGreaterThan(MIN_RADIUS);
      }
    });
  });

  describe("totalTopics running counter", () => {
    it("should increment totalTopics for each new topic path segment", () => {
      expect(state().totalTopics).toBe(0);

      // "a/b/c" creates 3 new nodes: a, a/b, a/b/c
      // Counters are batched — flush via rebuildGraph (synchronous rAF stand-in)
      state().handleMessage("a/b/c", "hello", 0);
      state().rebuildGraph();
      expect(state().totalTopics).toBe(3);
    });

    it("should not increment totalTopics for repeated messages to existing topics", () => {
      state().handleMessage("a/b/c", "msg1", 0);
      state().rebuildGraph();
      expect(state().totalTopics).toBe(3);

      state().handleMessage("a/b/c", "msg2", 0);
      state().rebuildGraph();
      // No new nodes — count unchanged
      expect(state().totalTopics).toBe(3);
    });

    it("should increment totalTopics only for genuinely new segments", () => {
      state().handleMessage("a/b/c", "msg1", 0);
      state().rebuildGraph();
      expect(state().totalTopics).toBe(3); // a, a/b, a/b/c

      // "a/b/d" shares "a" and "a/b" — only "a/b/d" is new
      state().handleMessage("a/b/d", "msg2", 0);
      state().rebuildGraph();
      expect(state().totalTopics).toBe(4);
    });

    it("should reset totalTopics to 0 on reset()", () => {
      state().handleMessage("a/b/c", "hello", 0);
      state().rebuildGraph();
      expect(state().totalTopics).toBe(3);

      state().reset();
      expect(state().totalTopics).toBe(0);
    });
  });

  describe("payload storage — LRU eviction and opt-in", () => {
    it("should store lastPayload on the TopicNode when tooltips are enabled", () => {
      state().setShowTooltips(true);
      handleMessageAndFlush("a/b/c", "hello world");

      const leaf = findTopicNode("a/b/c");
      expect(leaf).toBeDefined();
      expect(leaf!.lastPayload).toBe("hello world");
    });

    it("should NOT store lastPayload when tooltips are disabled", () => {
      state().setShowTooltips(false);
      handleMessageAndFlush("a/b/c", "hello world");

      const leaf = findTopicNode("a/b/c");
      expect(leaf).toBeDefined();
      expect(leaf!.lastPayload).toBeNull();
    });

    it("should truncate payloads longer than 1024 characters at ingest", () => {
      state().setShowTooltips(true);
      const longPayload = "x".repeat(2000);
      handleMessageAndFlush("a/b/c", longPayload);

      const leaf = findTopicNode("a/b/c");
      expect(leaf).toBeDefined();
      expect(leaf!.lastPayload).toHaveLength(1024);
      expect(leaf!.lastPayload).toBe("x".repeat(1024));
    });

    it("should evict the oldest payload when LRU cap (200) is exceeded", () => {
      state().setShowTooltips(true);

      // Send messages to 201 unique topics (single-segment to keep it fast)
      for (let i = 0; i < 201; i++) {
        state().handleMessage(`topic${i}`, `payload${i}`, 0);
      }
      state().rebuildGraph();

      // The first topic (topic0) should have been evicted
      const evicted = findTopicNode("topic0");
      expect(evicted).toBeDefined();
      expect(evicted!.lastPayload).toBeNull();

      // The most recent topic should still have its payload
      const recent = findTopicNode("topic200");
      expect(recent).toBeDefined();
      expect(recent!.lastPayload).toBe("payload200");

      // A topic in the middle (topic1) should still have its payload
      // (it was the 2nd oldest, but only 1 eviction occurred for 201 topics)
      const middle = findTopicNode("topic1");
      expect(middle).toBeDefined();
      expect(middle!.lastPayload).toBe("payload1");
    });

    it("should evict multiple payloads when far exceeding the LRU cap", () => {
      state().setShowTooltips(true);

      // Send messages to 210 unique topics
      for (let i = 0; i < 210; i++) {
        state().handleMessage(`t${i}`, `p${i}`, 0);
      }
      state().rebuildGraph();

      // The first 10 topics (t0 through t9) should have been evicted
      for (let i = 0; i < 10; i++) {
        const evicted = findTopicNode(`t${i}`);
        expect(evicted).toBeDefined();
        expect(evicted!.lastPayload).toBeNull();
      }

      // Topic t10 should still have its payload (it's the 11th oldest, cap=200, 210-200=10 evicted)
      const kept = findTopicNode("t10");
      expect(kept).toBeDefined();
      expect(kept!.lastPayload).toBe("p10");
    });

    it("should refresh LRU position when a topic receives another message", () => {
      state().setShowTooltips(true);

      // Fill up to 200 unique topics
      for (let i = 0; i < 200; i++) {
        state().handleMessage(`topic${i}`, `payload${i}`, 0);
      }

      // Re-send to topic0 — this moves it to the most-recent position
      state().handleMessage("topic0", "refreshed", 0);

      // Now send one more new topic to trigger an eviction
      state().handleMessage("newTopic", "new", 0);
      state().rebuildGraph();

      // topic0 should NOT be evicted (it was refreshed)
      const refreshed = findTopicNode("topic0");
      expect(refreshed).toBeDefined();
      expect(refreshed!.lastPayload).toBe("refreshed");

      // topic1 should be evicted (it's now the oldest)
      const evicted = findTopicNode("topic1");
      expect(evicted).toBeDefined();
      expect(evicted!.lastPayload).toBeNull();
    });

    it("should clear all payloads when setShowTooltips(false) is called", () => {
      state().setShowTooltips(true);

      handleMessageAndFlush("a/b/c", "hello");
      handleMessageAndFlush("x/y", "world");

      // Verify payloads are stored
      expect(findTopicNode("a/b/c")!.lastPayload).toBe("hello");
      expect(findTopicNode("x/y")!.lastPayload).toBe("world");

      // Disable tooltips — should clear all payloads
      state().setShowTooltips(false);

      expect(findTopicNode("a/b/c")!.lastPayload).toBeNull();
      expect(findTopicNode("x/y")!.lastPayload).toBeNull();
    });

    it("should clear payloads on reset()", () => {
      state().setShowTooltips(true);
      handleMessageAndFlush("a/b/c", "hello");

      expect(findTopicNode("a/b/c")!.lastPayload).toBe("hello");

      state().reset();

      // After reset, the old tree is gone — a new root with no children
      expect(state().root.children.size).toBe(0);
    });

    it("should store payload exactly at 1024 chars without truncation", () => {
      state().setShowTooltips(true);
      const exactPayload = "y".repeat(1024);
      handleMessageAndFlush("a/b/c", exactPayload);

      const leaf = findTopicNode("a/b/c");
      expect(leaf!.lastPayload).toHaveLength(1024);
      expect(leaf!.lastPayload).toBe(exactPayload);
    });

    it("should update lastPayload when a new message arrives on the same topic", () => {
      state().setShowTooltips(true);
      handleMessageAndFlush("a/b/c", "first");
      expect(findTopicNode("a/b/c")!.lastPayload).toBe("first");

      handleMessageAndFlush("a/b/c", "second");
      expect(findTopicNode("a/b/c")!.lastPayload).toBe("second");
    });
  });

  describe("nodeScale — radius multiplier", () => {
    it("should default to 1.0", () => {
      expect(state().nodeScale).toBe(1.0);
    });

    it("should scale node radius when nodeScale > 1", () => {
      handleMessageAndFlush("a/b/c", "hello");
      const defaultRadius = findGraphNode("a/b/c")!.radius;

      state().setNodeScale(2.0);
      const scaledRadius = findGraphNode("a/b/c")!.radius;
      expect(scaledRadius).toBeCloseTo(defaultRadius * 2, 1);
    });

    it("should shrink node radius when nodeScale < 1", () => {
      handleMessageAndFlush("a/b/c", "hello");
      const defaultRadius = findGraphNode("a/b/c")!.radius;

      state().setNodeScale(0.5);
      const scaledRadius = findGraphNode("a/b/c")!.radius;
      expect(scaledRadius).toBeCloseTo(defaultRadius * 0.5, 1);
    });

    it("should scale MIN_RADIUS nodes proportionally", () => {
      // An idle node (rate=0) should have radius = MIN_RADIUS * nodeScale
      handleMessageAndFlush("a/b/c", "hello");

      // Ancestor "a" has messageRate=0 when ancestorPulse uses aggregateRate,
      // but with ancestorPulse on, it uses aggregateRate. Turn it off for a clean test.
      state().setAncestorPulse(false);
      state().rebuildGraph();

      const parentRadius = findGraphNode("a")!.radius;
      expect(parentRadius).toBe(MIN_RADIUS); // rate=0 → MIN_RADIUS * 1.0

      state().setNodeScale(1.5);
      const scaledParent = findGraphNode("a")!.radius;
      expect(scaledParent).toBeCloseTo(MIN_RADIUS * 1.5, 5);
    });
  });

  describe("scaleNodeSizeByDepth", () => {
    it("should default to true", () => {
      expect(state().scaleNodeSizeByDepth).toBe(true);
    });

    it("should toggle via setter", () => {
      state().setScaleNodeSizeByDepth(true);
      expect(state().scaleNodeSizeByDepth).toBe(true);
      state().setScaleNodeSizeByDepth(false);
      expect(state().scaleNodeSizeByDepth).toBe(false);
    });
  });

  describe("graphStructureVersion", () => {
    it("should start at 0", () => {
      expect(state().graphStructureVersion).toBe(0);
    });

    it("should increment after a structural rebuild (new topic)", () => {
      // handleMessage schedules rebuild via rAF. In tests, we flush manually.
      state().handleMessage("a/b/c", "hello", 0);

      // The scheduleRebuild(true) was called but rAF hasn't fired in the test env.
      // Calling rebuildGraph() directly doesn't bump graphStructureVersion — 
      // that only happens inside scheduleRebuild's rAF callback.
      // Instead we verify the version increments after the rAF fires.

      // Wait for rAF to fire (our polyfill uses setTimeout(cb, 0))
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(state().graphStructureVersion).toBe(1);
          resolve();
        }, 10);
      });
    });

    it("should not increment on repeated messages to existing topics", () => {
      state().handleMessage("a/b/c", "msg1", 0);

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // First message created structure — version should be 1
          expect(state().graphStructureVersion).toBe(1);

          // Second message to same topic — no structural change
          state().handleMessage("a/b/c", "msg2", 0);

          setTimeout(() => {
            // Version should still be 1 — no new nodes
            expect(state().graphStructureVersion).toBe(1);
            resolve();
          }, 10);
        }, 10);
      });
    });

    it("should reset to 0 on reset()", () => {
      state().handleMessage("a/b/c", "hello", 0);

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(state().graphStructureVersion).toBe(1);
          state().reset();
          expect(state().graphStructureVersion).toBe(0);
          resolve();
        }, 10);
      });
    });
  });

  describe("selectedNodeId", () => {
    beforeEach(() => {
      state().reset();
    });

    it("should default to null", () => {
      expect(state().selectedNodeId).toBeNull();
    });

    it("should set a node ID", () => {
      state().setSelectedNodeId("home/kitchen/temp");
      expect(state().selectedNodeId).toBe("home/kitchen/temp");
    });

    it("should switch to a different node ID", () => {
      state().setSelectedNodeId("home/kitchen/temp");
      state().setSelectedNodeId("home/living/light");
      expect(state().selectedNodeId).toBe("home/living/light");
    });

    it("should clear selection when set to null", () => {
      state().setSelectedNodeId("home/kitchen/temp");
      state().setSelectedNodeId(null);
      expect(state().selectedNodeId).toBeNull();
    });

    it("should reset to null on reset()", () => {
      state().setSelectedNodeId("home/kitchen/temp");
      state().reset();
      expect(state().selectedNodeId).toBeNull();
    });
  });

  describe("resetSettings", () => {
    beforeEach(() => {
      state().reset();
    });

    it("should reset all visual/label/simulation settings to defaults after modification", () => {
      // Modify every settings field away from defaults
      state().setEmaTau(20);
      state().setShowLabels(false);
      state().setLabelDepthFactor(10);
      state().setLabelMode("depth");
      state().setLabelFontSize(32);
      state().setScaleTextByDepth(false);
      state().setShowTooltips(false);
      state().setNodeScale(3.5);
      state().setScaleNodeSizeByDepth(true);
      state().setRepulsionStrength(-999);
      state().setLinkDistance(500);
      state().setLinkStrength(0.1);
      state().setCollisionPadding(50);
      state().setAlphaDecay(0.05);
      state().setAncestorPulse(false);
      state().setShowRootPath(true);

      // Verify they changed
      expect(state().emaTau).toBe(20);
      expect(state().showLabels).toBe(false);
      expect(state().nodeScale).toBe(3.5);
      expect(state().repulsionStrength).toBe(-999);

      // Reset settings
      state().resetSettings();

      // All should be back to defaults (config.json values or hardcoded fallbacks)
      expect(state().emaTau).toBe(5);
      expect(state().showLabels).toBe(true);
      expect(state().labelDepthFactor).toBe(2);
      expect(state().labelMode).toBe("zoom");
      expect(state().labelFontSize).toBe(15);
      expect(state().scaleTextByDepth).toBe(true);
      expect(state().showTooltips).toBe(true);
      expect(state().nodeScale).toBe(2.5);
      expect(state().scaleNodeSizeByDepth).toBe(true);
      expect(state().repulsionStrength).toBe(-350);
      expect(state().linkDistance).toBe(155);
      expect(state().linkStrength).toBe(0.3);
      expect(state().collisionPadding).toBe(13);
      expect(state().alphaDecay).toBe(0.01);
      expect(state().ancestorPulse).toBe(true);
      expect(state().showRootPath).toBe(false);
    });

    it("should NOT reset topic tree data", () => {
      // Build up some topic tree state
      handleMessageAndFlush("home/kitchen/temp", "22.5");
      handleMessageAndFlush("home/living/light", "on");
      const messagesBefore = state().totalMessages;
      const topicsBefore = state().totalTopics;
      const nodeCountBefore = state().graphNodes.length;
      expect(messagesBefore).toBe(2);
      expect(topicsBefore).toBeGreaterThan(0);
      expect(nodeCountBefore).toBeGreaterThan(0);

      // Modify a setting
      state().setEmaTau(20);

      // Reset settings
      state().resetSettings();

      // Topic tree data should be untouched
      expect(state().totalMessages).toBe(messagesBefore);
      expect(state().totalTopics).toBe(topicsBefore);
      expect(state().graphNodes.length).toBe(nodeCountBefore);
      expect(findTopicNode("home/kitchen/temp")).toBeDefined();
    });

    it("should NOT reset topicFilter", () => {
      state().setTopicFilter("sensors/#");
      state().resetSettings();
      expect(state().topicFilter).toBe("sensors/#");
    });

    it("should NOT reset selectedNodeId or connectionStatus", () => {
      state().setSelectedNodeId("home/kitchen/temp");
      state().setConnectionStatus("connected");
      state().resetSettings();
      expect(state().selectedNodeId).toBe("home/kitchen/temp");
      expect(state().connectionStatus).toBe("connected");
    });
  });
});

describe("topicStore — highlight sets", () => {
  beforeEach(() => {
    state().reset();
    state().setShowRootPath(true);
    state().setTopicFilter("#");
    state().clearHighlights();
  });

  it("should initialise with an empty highlighted nodes map", () => {
    expect(state().highlightedNodes.size).toBe(0);
  });

  it("setHighlightedNodes should store the provided map", () => {
    const highlights = new Map([
      ["home/kitchen/temp", "#f59e0b"],
      ["home/living/light", "#60a5fa"],
    ]);
    state().setHighlightedNodes(highlights);
    expect(state().highlightedNodes.size).toBe(2);
    expect(state().highlightedNodes.get("home/kitchen/temp")).toBe("#f59e0b");
    expect(state().highlightedNodes.get("home/living/light")).toBe("#60a5fa");
  });

  it("setHighlightedNodes should replace the previous map entirely", () => {
    state().setHighlightedNodes(new Map([["home/kitchen/temp", "#f59e0b"]]));
    state().setHighlightedNodes(new Map([["home/living/light", "#60a5fa"]]));
    expect(state().highlightedNodes.size).toBe(1);
    expect(state().highlightedNodes.has("home/kitchen/temp")).toBe(false);
    expect(state().highlightedNodes.get("home/living/light")).toBe("#60a5fa");
  });

  it("setHighlightedNodes should cap entries at 200", () => {
    const large = new Map<string, string>();
    for (let i = 0; i < 250; i++) {
      large.set(`topic/${i}`, "#f59e0b");
    }
    state().setHighlightedNodes(large);
    expect(state().highlightedNodes.size).toBe(200);
  });

  it("clearHighlights should remove all highlighted nodes", () => {
    state().setHighlightedNodes(new Map([
      ["home/kitchen/temp", "#f59e0b"],
      ["home/living/light", "#60a5fa"],
    ]));
    expect(state().highlightedNodes.size).toBe(2);
    state().clearHighlights();
    expect(state().highlightedNodes.size).toBe(0);
  });

  it("reset() should clear highlighted nodes", () => {
    state().setHighlightedNodes(new Map([["home/kitchen/temp", "#f59e0b"]]));
    expect(state().highlightedNodes.size).toBe(1);
    state().reset();
    expect(state().highlightedNodes.size).toBe(0);
  });

  it("resetSettings() should NOT clear highlighted nodes", () => {
    state().setHighlightedNodes(new Map([["home/kitchen/temp", "#f59e0b"]]));
    state().resetSettings();
    expect(state().highlightedNodes.size).toBe(1);
    expect(state().highlightedNodes.get("home/kitchen/temp")).toBe("#f59e0b");
  });
});

describe("topicStore — batched counter updates (Part 1)", () => {
  beforeEach(() => {
    state().reset();
    state().setShowRootPath(true);
    state().setTopicFilter("#");
  });

  it("should batch counter updates — totalMessages reflects all messages after rAF flush", () => {
    // Send multiple messages without flushing between them
    state().handleMessage("a/b", "1", 0);
    state().handleMessage("a/c", "2", 0);
    state().handleMessage("a/d", "3", 0);

    // Counters are pending — not yet flushed to store state
    // (they're accumulated in module-level vars and flushed in the rAF callback)
    // We flush synchronously via rebuildGraph to simulate the rAF firing
    state().rebuildGraph();

    // After a manual rebuild the rAF accumulators may not have fired yet in tests,
    // so verify the counters are correct after explicit flush
    expect(state().totalMessages).toBeGreaterThanOrEqual(3);
    expect(state().totalTopics).toBeGreaterThan(0);
  });

  it("should reset pending counters on reset()", () => {
    state().handleMessage("x/y", "hi", 0);
    state().reset();
    // After reset, counters are 0 and pending accumulators are cleared
    expect(state().totalMessages).toBe(0);
    expect(state().totalTopics).toBe(0);
  });

  it("should accumulate totalMessages correctly across a burst then flush", () => {
    const initialMessages = state().totalMessages;

    // Simulate a burst of 10 messages
    for (let i = 0; i < 10; i++) {
      state().handleMessage(`sensor/${i}`, `val${i}`, 0);
    }

    // Flush via rebuildGraph (simulates rAF callback in tests)
    state().rebuildGraph();

    // All 10 messages should be reflected after flush
    expect(state().totalMessages).toBeGreaterThanOrEqual(initialMessages + 10);
  });
});

describe("topicStore — decay rebuild suppression during burst (Part 3)", () => {
  beforeEach(() => {
    state().reset();
    state().setShowRootPath(true);
    state().setTopicFilter("#");
  });

  it("decayTick should still update tree rates even when rebuild is suppressed", () => {
    // Send a message to create a node with a rate
    state().handleMessage("home/temp", "22", 0);
    state().rebuildGraph();

    const topicNode = (() => {
      const root = state().root;
      const segs = "home/temp".split("/");
      let cur = root;
      for (const s of segs) {
        const child = cur.children.get(s);
        if (!child) return undefined;
        cur = child;
      }
      return cur;
    })();

    expect(topicNode).toBeDefined();
    const rateBefore = topicNode!.messageRate;

    // decayTick should decay the rate regardless of rebuild scheduling
    state().decayTick();
    expect(topicNode!.messageRate).toBeLessThanOrEqual(rateBefore);
  });

  it("decayTick should produce graphNodes when no structural rebuild is pending", () => {
    state().handleMessage("a/b", "x", 0);
    state().rebuildGraph();

    const nodesBefore = state().graphNodes.length;
    expect(nodesBefore).toBeGreaterThan(0);

    // With no pending rAF rebuild, decayTick should update graphNodes normally
    state().decayTick();
    // Node count should be unchanged (no structural change)
    expect(state().graphNodes.length).toBe(nodesBefore);
  });
});

// ---------------------------------------------------------------------------
// Settings persistence (localStorage round-trip) — Issue #21
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory localStorage shim for the Node/Vitest environment.
 * The store reads from localStorage at module initialisation, so we can only
 * test the setter → localStorage → loadSavedSettings() path here, not the
 * initial-state-read path (the store is already created by import time).
 */
class LocalStorageMock {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key: string, value: string): void { this.store[key] = value; }
  removeItem(key: string): void { delete this.store[key]; }
  clear(): void { this.store = {}; }
}

const lsMock = new LocalStorageMock();

describe("topicStore — settings localStorage persistence (Issue #21)", () => {
  beforeEach(() => {
    lsMock.clear();
    Object.defineProperty(globalThis, "localStorage", {
      value: lsMock,
      configurable: true,
      writable: true,
    });
    state().reset();
  });

  afterEach(() => {
    lsMock.clear();
  });

  it("setEmaTau persists emaTau to localStorage", () => {
    state().setEmaTau(8);
    expect(loadSavedSettings().emaTau).toBe(8);
  });

  it("setShowLabels persists showLabels to localStorage", () => {
    state().setShowLabels(false);
    expect(loadSavedSettings().showLabels).toBe(false);
  });

  it("setLabelDepthFactor persists labelDepthFactor", () => {
    state().setLabelDepthFactor(12);
    expect(loadSavedSettings().labelDepthFactor).toBe(12);
  });

  it("setLabelMode persists labelMode", () => {
    state().setLabelMode("depth");
    expect(loadSavedSettings().labelMode).toBe("depth");
  });

  it("setLabelFontSize persists labelFontSize", () => {
    state().setLabelFontSize(20);
    expect(loadSavedSettings().labelFontSize).toBe(20);
  });

  it("setScaleTextByDepth persists scaleTextByDepth", () => {
    state().setScaleTextByDepth(false);
    expect(loadSavedSettings().scaleTextByDepth).toBe(false);
  });

  it("setShowTooltips persists showTooltips", () => {
    state().setShowTooltips(false);
    expect(loadSavedSettings().showTooltips).toBe(false);
  });

  it("setNodeScale persists nodeScale", () => {
    state().setNodeScale(2.5);
    expect(loadSavedSettings().nodeScale).toBe(2.5);
  });

  it("setScaleNodeSizeByDepth persists scaleNodeSizeByDepth", () => {
    state().setScaleNodeSizeByDepth(true);
    expect(loadSavedSettings().scaleNodeSizeByDepth).toBe(true);
  });

  it("setRepulsionStrength persists repulsionStrength", () => {
    state().setRepulsionStrength(-200);
    expect(loadSavedSettings().repulsionStrength).toBe(-200);
  });

  it("setLinkDistance persists linkDistance", () => {
    state().setLinkDistance(200);
    expect(loadSavedSettings().linkDistance).toBe(200);
  });

  it("setLinkStrength persists linkStrength", () => {
    state().setLinkStrength(0.8);
    expect(loadSavedSettings().linkStrength).toBe(0.8);
  });

  it("setCollisionPadding persists collisionPadding", () => {
    state().setCollisionPadding(10);
    expect(loadSavedSettings().collisionPadding).toBe(10);
  });

  it("setAlphaDecay persists alphaDecay", () => {
    state().setAlphaDecay(0.02);
    expect(loadSavedSettings().alphaDecay).toBeCloseTo(0.02);
  });

  it("setAncestorPulse persists ancestorPulse", () => {
    state().setAncestorPulse(false);
    expect(loadSavedSettings().ancestorPulse).toBe(false);
  });

  it("setShowRootPath persists showRootPath", () => {
    state().setShowRootPath(true);
    expect(loadSavedSettings().showRootPath).toBe(true);
  });

  it("multiple setter calls accumulate in localStorage (merge, not replace)", () => {
    state().setEmaTau(7);
    state().setNodeScale(3);
    state().setShowLabels(false);
    const saved = loadSavedSettings();
    expect(saved.emaTau).toBe(7);
    expect(saved.nodeScale).toBe(3);
    expect(saved.showLabels).toBe(false);
  });

  it("resetSettings clears localStorage saved settings", () => {
    // Save something first
    persistSettings({ emaTau: 10, nodeScale: 3 });
    expect(loadSavedSettings().emaTau).toBe(10);

    state().resetSettings();

    // localStorage should be cleared after resetSettings
    expect(loadSavedSettings()).toEqual({});
  });

  it("clearSavedSettings removes all persisted settings", () => {
    state().setEmaTau(9);
    state().setLabelFontSize(24);
    expect(loadSavedSettings().emaTau).toBe(9);

    clearSavedSettings();
    expect(loadSavedSettings()).toEqual({});
  });

  it("reset() preserves nodeScale and scaleNodeSizeByDepth from localStorage (reconnect bug)", () => {
    // Simulate: user sets nodeScale, then reconnects (which calls reset())
    state().setNodeScale(2.5);
    state().setScaleNodeSizeByDepth(true);
    expect(loadSavedSettings().nodeScale).toBe(2.5);

    // reset() is called on connect — should NOT wipe back to config defaults
    state().reset();

    expect(state().nodeScale).toBe(2.5);
    expect(state().scaleNodeSizeByDepth).toBe(true);
  });
});
