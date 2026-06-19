import { useEffect } from "react";
import { useTopicStore } from "../stores/topicStore";
import { getKioskTiming } from "../utils/config";
import { findNode } from "../utils/topicParser";
import type { GraphNode } from "../types";
import type { TopicTab } from "../components/TopicDrawer";

/** Callbacks the tour uses to drive the floating drawer (owned by App). */
export interface KioskTourHandlers {
  /** Select a node and populate the drawer; returns true if it has an entity tab. */
  onSelectNode: (nodeId: string) => boolean;
  /** Switch the drawer's active tab. */
  onSetTab: (tab: TopicTab) => void;
  /** Clear selection — return focus to the bare graph. */
  onClear: () => void;
  /** Drift the view to an overview over `durationMs` while no node is highlighted. */
  onShowOverview: (durationMs: number) => void;
  /** Shake the force layout (called periodically between highlights). */
  onShake: () => void;
}

/** Whether a node's payload (or image) is actually retained, so the drawer has content to show. */
function hasStoredPayload(nodeId: string): boolean {
  const root = useTopicStore.getState().root;
  const tn = findNode(root, nodeId === "" ? [] : nodeId.split("/"));
  return !!tn && (tn.lastPayload !== null || tn.lastImageBlobUrl !== null);
}

/** Selection weight for nodes carrying a detected entity/ecosystem tag. */
const RICH_WEIGHT = 3;
/** Selection weight for plain nodes. */
const PLAIN_WEIGHT = 1;

/**
 * Pick the next tour node from the live graph, biasing toward "rich" nodes
 * (those with detected payload tags — geo/image/sparkplug or ecosystem
 * detectors). Prefers recently-active nodes, avoids repeating the previous pick.
 */
function pickCandidate(prevId: string | null): GraphNode | null {
  const nodes = useTopicStore.getState().graphNodes.filter((n) => n.id !== "");
  if (nodes.length === 0) return null;

  // Prefer recently-active nodes; fall back to all nodes if none are active.
  let pool = nodes.filter((n) => n.messageRate > 0);
  if (pool.length === 0) pool = nodes;

  // Only tour nodes whose payload/image is actually cached — otherwise the
  // drawer would open on an empty payload. If none qualify, skip this round.
  pool = pool.filter((n) => hasStoredPayload(n.id));
  if (pool.length === 0) return null;

  // Avoid immediately repeating the previous pick (unless it's the only option).
  const deduped = pool.filter((n) => n.id !== prevId);
  if (deduped.length > 0) pool = deduped;

  const weightOf = (n: GraphNode) =>
    n.payloadTags && n.payloadTags.length > 0 ? RICH_WEIGHT : PLAIN_WEIGHT;
  const total = pool.reduce((sum, n) => sum + weightOf(n), 0);
  let r = Math.random() * total;
  for (const n of pool) {
    r -= weightOf(n);
    if (r <= 0) return n;
  }
  return pool[pool.length - 1];
}

/**
 * Kiosk auto-tour. While `active`, cycles through the graph: pick a node,
 * highlight it, show its entity panel (then payload) or just its payload,
 * then deselect. Inserts a graph-only rest after every `restEvery` highlights.
 * All timers are torn down when `active` goes false (e.g. user interaction).
 */
export function useKioskTour(active: boolean, handlers: KioskTourHandlers): void {
  const { onSelectNode, onSetTab, onClear, onShowOverview, onShake } = handlers;

  useEffect(() => {
    if (!active) return;

    const t = getKioskTiming();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let sinceRest = 0;
    let totalHighlights = 0;
    let prevId: string | null = null;

    const schedule = (fn: () => void, ms: number) => {
      timer = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    };

    const afterNode = () => {
      onClear();
      sinceRest += 1;
      totalHighlights += 1;
      // Periodically shake the layout loose so the graph keeps re-arranging.
      if (totalHighlights % t.shakeEvery === 0) onShake();
      // While no node is highlighted, slowly drift the view out to an overview.
      const span = sinceRest >= t.restEvery ? t.restMs : t.intervalMs;
      onShowOverview(span);
      if (sinceRest >= t.restEvery) {
        sinceRest = 0;
        schedule(loop, t.restMs); // longer graph-only breather
      } else {
        schedule(loop, t.intervalMs);
      }
    };

    const showNext = () => {
      const candidate = pickCandidate(prevId);
      if (!candidate) {
        // Nothing to show (no cached payloads yet) — drift to overview and retry.
        onShowOverview(t.intervalMs);
        schedule(loop, t.intervalMs);
        return;
      }
      prevId = candidate.id;
      const hasEntity = onSelectNode(candidate.id);
      if (hasEntity) {
        schedule(() => {
          onSetTab("payload");
          schedule(afterNode, t.payloadDwellMs);
        }, t.entityDwellMs);
      } else {
        schedule(afterNode, t.plainDwellMs);
      }
    };

    function loop() {
      showNext();
    }

    loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, onSelectNode, onSetTab, onClear, onShowOverview, onShake]);
}
