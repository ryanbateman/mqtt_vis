import { create } from "zustand";
import type {
  TopicNode,
  ConnectionStatus,
  GraphNode,
  GraphLink,
  LabelMode,
  MqttUserProperties,
} from "../types";
import type { DetectorResult } from "../types/payloadTags";
import { payloadAnalyzer } from "../services/payloadAnalyzerService";
import {
  createTopicNode,
  ensureTopicPathTracked,
  flattenTree,
  collectAllNodes,
  getAncestorPaths,
  getFixedPrefix,
  findNode,
} from "../utils/topicParser";
import { calculateRadius } from "../utils/sizeCalculator";
import { getConfig } from "../utils/config";
import { perfMark, perfMeasure, perfStats } from "../utils/perfDebug";
import {
  loadSavedSettings,
  persistSettings,
  clearSavedSettings,
} from "../utils/settingsStorage";

/** Default EMA time constant in seconds. Controls how quickly rates respond. */
const DEFAULT_EMA_TAU = 5;

/** Decay interval in milliseconds. */
const DECAY_INTERVAL = 500;

/**
 * Pulse duration equals emaTau in milliseconds.
 * This means "Fade Time = 5s" produces a 5-second fade window.
 */

interface TopicStoreState {
  /** Root of the topic tree. */
  root: TopicNode;
  /** Flattened graph nodes for D3. */
  graphNodes: GraphNode[];
  /** Links between parent/child for D3. */
  graphLinks: GraphLink[];
  /** MQTT connection status. */
  connectionStatus: ConnectionStatus;
  /** Total messages received this session. */
  totalMessages: number;
  /** Total unique topics discovered (excluding root). */
  totalTopics: number;
  /** Session start time. */
  sessionStart: number;
  /** Error message if connection failed. */
  errorMessage: string | null;
  /** EMA time constant in seconds. Controls how long messages affect node appearance. */
  emaTau: number;
  /** Whether labels are visible at all. */
  showLabels: boolean;
  /** Controls how many tree depths of labels are visible at a given zoom level. */
  labelDepthFactor: number;
  /** How label visibility is determined: 'zoom' (fade by zoom level) or 'depth' (hard cutoff by tree depth). */
  labelMode: LabelMode;
  /** Base font size for labels in pixels. Used as maximum when depth scaling is on. */
  labelFontSize: number;
  /** Stroke width for the label text halo outline (4.5–13.5). */
  labelStrokeWidth: number;
  /** Whether to scale label text size inversely with tree depth. */
  scaleTextByDepth: boolean;
  /** Whether to show tooltips on node hover. */
  showTooltips: boolean;
  /** Multiplier for node radius (0.5–4.0). Scales both min and max radius proportionally. */
  nodeScale: number;
  /** Whether to scale node display radius inversely with tree depth. */
  scaleNodeSizeByDepth: boolean;

  // --- Simulation parameters ---
  /** Repulsion strength between nodes (negative = repel). */
  repulsionStrength: number;
  /** Ideal distance between linked parent-child nodes. */
  linkDistance: number;
  /** How rigidly links enforce their ideal distance (0..1). */
  linkStrength: number;
  /** Extra pixels added to node radius for collision detection. */
  collisionPadding: number;
  /** How quickly the simulation settles after changes. */
  alphaDecay: number;
  /** Inactivity timeout (ms) after which stale nodes are pruned. 0 = disabled. */
  pruneTimeout: number;
  /** Whether to fully drop retained messages during the post-subscribe burst window. */
  dropRetainedBurst: boolean;
  /** Duration (ms) of the burst window after connection during which retained messages are dropped. */
  burstWindowDuration: number;
  /** Whether to show geo-tagged node indicator rings in the graph. */
  showGeoIndicators: boolean;
  /** Whether to show image-tagged node indicator rings in the graph. */
  showImageIndicators: boolean;
  /** Whether ancestor nodes pulse when a descendant receives a message. */
  ancestorPulse: boolean;
  /** Whether to show the structural root-path nodes above the subscription prefix. */
  showRootPath: boolean;
  /** The current MQTT subscription topic filter. */
  topicFilter: string;
  /**
   * Incremented whenever the graph structure changes (nodes added/removed).
   * Rate-only changes (pulse, decay) do NOT increment this.
   * TopicGraph uses this to decide whether to call renderer.update() (D3 data join)
   * or just let the animation loop handle visual updates.
   */
  graphStructureVersion: number;
  /** Incremented when an export is requested. TopicGraph watches this to trigger renderer.exportPng(). */
  exportRequested: number;
  /** ID of the currently selected/pinned node, or null if nothing is selected. */
  selectedNodeId: string | null;
  /**
   * Map of nodeId → CSS colour hex for externally highlighted nodes.
   * Populated by WebMCP tools or other internal consumers.
   * Capped at MAX_HIGHLIGHTED_NODES entries (silently truncated).
   */
  highlightedNodes: Map<string, string>;
  /** Whether the burst drop window is currently active (dropping retained messages). UI-only — drives the header indicator. */
  burstWindowActive: boolean;
  /** Whether burst settings (checkbox + slider) are locked. True from connect (when dropRetainedBurst is on) until disconnect. */
  burstSettingsLocked: boolean;

  /** Toggle ancestor pulse behaviour. */
  setAncestorPulse: (enabled: boolean) => void;
  /** Toggle root path node visibility. */
  setShowRootPath: (enabled: boolean) => void;
  /** Store the current topic filter (called on connect). */
  setTopicFilter: (filter: string) => void;

  /** Process an incoming MQTT message. retain defaults to false for backward compatibility. */
  handleMessage: (topic: string, payload: string, qos: 0 | 1 | 2, retain?: boolean, userProperties?: MqttUserProperties, imageBlobUrl?: string) => void;
  /** Update connection status. */
  setConnectionStatus: (status: ConnectionStatus, error?: string) => void;
  /** Run one decay tick — called periodically. */
  decayTick: () => void;
  /** Rebuild the flat graph data from the tree. */
  rebuildGraph: () => void;
  /**
   * Schedule a graph rebuild on the next animation frame.
   * Multiple calls within the same frame are coalesced into one rebuild.
   */
  scheduleRebuild: (structural: boolean) => void;
  /** Reset the store (on disconnect). */
  reset: () => void;
  /** Reset all visual, label, and simulation settings to config.json defaults. */
  resetSettings: () => void;
  /** Update the EMA time constant. */
  setEmaTau: (tau: number) => void;
  /** Toggle label visibility. */
  setShowLabels: (show: boolean) => void;
  /** Update the label depth factor. */
  setLabelDepthFactor: (factor: number) => void;
  /** Update the label visibility mode. */
  setLabelMode: (mode: LabelMode) => void;
  /** Update the base label font size. */
  setLabelFontSize: (size: number) => void;
  /** Update the label text halo stroke width. */
  setLabelStrokeWidth: (width: number) => void;
  /** Toggle depth-based text scaling. */
  setScaleTextByDepth: (enabled: boolean) => void;
  /** Toggle hover tooltips on nodes. */
  setShowTooltips: (show: boolean) => void;
  /** Update the node radius scale multiplier. */
  setNodeScale: (scale: number) => void;
  /** Toggle depth-based node size scaling. */
  setScaleNodeSizeByDepth: (enabled: boolean) => void;
  /** Update simulation parameters. */
  setRepulsionStrength: (value: number) => void;
  setLinkDistance: (value: number) => void;
  setLinkStrength: (value: number) => void;
  setCollisionPadding: (value: number) => void;
  setAlphaDecay: (value: number) => void;
  /** Update the prune timeout (ms). 0 = disabled. */
  setPruneTimeout: (value: number) => void;
  /** Toggle dropping retained messages during burst window. */
  setDropRetainedBurst: (enabled: boolean) => void;
  /** Update the burst window duration (ms). */
  setBurstWindowDuration: (value: number) => void;
  /** Toggle geo indicator rings in the graph. */
  setShowGeoIndicators: (enabled: boolean) => void;
  /** Toggle image indicator rings in the graph. */
  setShowImageIndicators: (enabled: boolean) => void;
  /** Request a PNG export of the current graph. */
  requestExport: () => void;
  /** Set the currently selected/pinned node (or null to deselect). */
  setSelectedNodeId: (id: string | null) => void;
  /**
   * Replace the full highlighted-node set. Entries beyond MAX_HIGHLIGHTED_NODES
   * are silently dropped. Pass an empty Map (or call clearHighlights) to remove all highlights.
   */
  setHighlightedNodes: (nodes: Map<string, string>) => void;
  /** Remove all node highlights. */
  clearHighlights: () => void;
  /** Store payload analysis tags on a topic node (called by the analyzer worker callback). */
  setPayloadTags: (nodeId: string, tags: DetectorResult[]) => void;
}

/**
 * Determine the visual root node for graph rendering.
 * When showRootPath is false, we skip the structural ancestors above the
 * subscription prefix — e.g. for "test/robot/huge/#", we start the graph
 * at the "huge" node (the last fixed segment before the first wildcard).
 */
function getVisualRoot(
  root: TopicNode,
  showRootPath: boolean,
  topicFilter: string
): TopicNode {
  if (showRootPath) return root;

  const prefix = getFixedPrefix(topicFilter);
  if (prefix.length === 0) return root; // e.g. "#" — nothing to skip

  // Walk to the parent of the last fixed segment
  const parentPath = prefix.slice(0, -1);
  const parentNode = findNode(root, parentPath);
  if (!parentNode) return root; // prefix doesn't exist in tree yet — fall back

  // The visual root is the last fixed segment's node
  const lastSegment = prefix[prefix.length - 1];
  const visualRoot = parentNode.children.get(lastSegment);
  if (!visualRoot) return root; // hasn't been created yet

  return visualRoot;
}

function buildGraphData(
  root: TopicNode,
  pulseDuration: number,
  showRootPath: boolean,
  topicFilter: string,
  ancestorPulse: boolean,
  nodeScale: number
): {
  graphNodes: GraphNode[];
  graphLinks: GraphLink[];
} {
  const visualRoot = getVisualRoot(root, showRootPath, topicFilter);
  const flat = flattenTree(visualRoot);
  const allNodes = collectAllNodes(visualRoot);
  const nodeMap = new Map<string, TopicNode>();
  for (const n of allNodes) {
    nodeMap.set(n.id, n);
  }

  const now = Date.now();

  const graphNodes: GraphNode[] = flat.map((f) => {
    const tn = nodeMap.get(f.nodeId)!;
    const r = calculateRadius(ancestorPulse ? tn.aggregateRate : tn.messageRate) * nodeScale;
    return {
      id: f.nodeId,
      label: f.label,
      radius: r,
      displayRadius: r,
      messageRate: tn.messageRate,
      aggregateRate: tn.aggregateRate,
      depth: f.depth,
      pulse: now - tn.lastTimestamp < pulseDuration,
      pulseTimestamp: tn.lastTimestamp,
      pulseRate: tn.pulseRate,
      payloadTags: tn.payloadTags ? tn.payloadTags.map((t) => t.tag) : null,
    };
  });

  // Build a map of node pulse state for link lookup
  const nodePulseMap = new Map<string, { pulse: boolean; pulseTimestamp: number }>();
  for (const gn of graphNodes) {
    nodePulseMap.set(gn.id, { pulse: gn.pulse, pulseTimestamp: gn.pulseTimestamp });
  }

  const graphLinks: GraphLink[] = flat
    .filter((f) => f.parentId !== null)
    .map((f) => {
      const src = nodePulseMap.get(f.parentId!);
      const tgt = nodePulseMap.get(f.nodeId);
      // Both endpoints must be pulsing for the link to pulse.
      // This ensures only links on the ancestor chain (root → leaf) light up,
      // not sibling branches that happen to share a pulsing ancestor.
      const bothPulsing = (src?.pulse ?? false) && (tgt?.pulse ?? false);
      return {
        source: f.parentId!,
        target: f.nodeId,
        pulse: bothPulsing,
        pulseTimestamp: bothPulsing
          ? Math.max(src?.pulseTimestamp ?? 0, tgt?.pulseTimestamp ?? 0)
          : 0,
      };
    });

  return { graphNodes, graphLinks };
}

/** Maximum number of nodes that retain their last payload (LRU eviction). */
const PAYLOAD_LRU_CAP = 200;

/** Maximum number of simultaneously highlighted nodes. Excess entries are silently truncated. */
const MAX_HIGHLIGHTED_NODES = 200;

/** Maximum characters stored per payload at ingest. */
const PAYLOAD_MAX_STORE = 1024;

/**
 * LRU tracker for payload storage. Insertion-ordered Set of node IDs.
 * Most-recently-used entry is last. When the set exceeds PAYLOAD_LRU_CAP,
 * the first (oldest) entry is evicted and its lastPayload is set to null.
 * Lives outside the store to avoid Zustand re-render triggers.
 */
const _payloadLru = new Set<string>();

/** Walk the topic tree and revoke all image blob URLs. Called on reset/disconnect. */
function revokeAllBlobUrls(node: TopicNode): void {
  if (node.lastImageBlobUrl) {
    URL.revokeObjectURL(node.lastImageBlobUrl);
    node.lastImageBlobUrl = null;
  }
  for (const child of node.children.values()) {
    revokeAllBlobUrls(child);
  }
}

/**
 * Module-level state for the batched rebuild scheduler.
 * Lives outside the store to avoid Zustand re-render triggers.
 */
let _rebuildScheduled = false;
let _rebuildStructural = false;
let _rebuildRafId: number | null = null;

/**
 * Pending counter deltas accumulated across messages within the current rAF batch.
 * Flushed into Zustand state in the scheduleRebuild rAF callback alongside the
 * graph data — collapses N set() calls per frame down to 1.
 */
let _pendingMessages = 0;
let _pendingNewTopics = 0;

/**
 * Burst throttle — reduces the frequency of structural (D3 data-join) rebuilds
 * during the initial retained-message flood after connecting.
 *
 * For the first BURST_WINDOW_MS after connection, structural rebuilds are
 * throttled to fire at most once every BURST_STRUCTURAL_INTERVAL_MS.
 * Rate-only updates continue per-frame as normal.
 */
const BURST_WINDOW_MS = 10_000;
const BURST_STRUCTURAL_INTERVAL_MS = 250;
let _burstWindowStart = 0;
let _lastStructuralFlush = 0;
let _burstThrottleId: ReturnType<typeof setTimeout> | null = null;
/** Timer that clears `burstWindowActive` after the burst window expires. */
let _burstActiveTimeoutId: ReturnType<typeof setTimeout> | null = null;

export const useTopicStore = create<TopicStoreState>((set, get) => {
  const cfg = getConfig();
  // Merge saved settings (localStorage) → config.json → hardcoded fallback.
  // Connection parameters (brokerUrl, topicFilter, etc.) are persisted
  // separately by useMqttClient under "mqtt_connection".
  const saved = loadSavedSettings();
  return {
  root: createTopicNode("", ""),
  graphNodes: [],
  graphLinks: [],
  connectionStatus: "disconnected",
  totalMessages: 0,
  totalTopics: 0,
  sessionStart: Date.now(),
  errorMessage: null,
  emaTau:               saved.emaTau             ?? cfg.emaTau             ?? DEFAULT_EMA_TAU,
  showLabels:           saved.showLabels          ?? cfg.showLabels          ?? true,
  labelDepthFactor:     saved.labelDepthFactor    ?? cfg.labelDepthFactor    ?? 2,
  labelMode:            saved.labelMode           ?? ((cfg.labelMode === "depth" || cfg.labelMode === "zoom" ? cfg.labelMode : "activity") as LabelMode),
  labelFontSize:        saved.labelFontSize       ?? cfg.labelFontSize       ?? 15,
  labelStrokeWidth:     saved.labelStrokeWidth    ?? cfg.labelStrokeWidth    ?? 9.0,
  scaleTextByDepth:     saved.scaleTextByDepth    ?? cfg.scaleTextByDepth    ?? true,
  showTooltips:         saved.showTooltips        ?? cfg.showTooltips        ?? true,
  nodeScale:            saved.nodeScale           ?? cfg.nodeScale           ?? 2.5,
  scaleNodeSizeByDepth: saved.scaleNodeSizeByDepth ?? cfg.scaleNodeSizeByDepth ?? true,
  repulsionStrength:    saved.repulsionStrength   ?? cfg.repulsionStrength   ?? -350,
  linkDistance:         saved.linkDistance        ?? cfg.linkDistance        ?? 155,
  linkStrength:         saved.linkStrength        ?? cfg.linkStrength        ?? 0.3,
  collisionPadding:     saved.collisionPadding    ?? cfg.collisionPadding    ?? 13,
  alphaDecay:           saved.alphaDecay          ?? cfg.alphaDecay          ?? 0.01,
  pruneTimeout:         saved.pruneTimeout        ?? cfg.pruneTimeout        ?? 0,
  dropRetainedBurst: saved.dropRetainedBurst ?? cfg.dropRetainedBurst ?? true,
  burstWindowDuration:  saved.burstWindowDuration  ?? cfg.burstWindowDuration  ?? 5_000,
  showGeoIndicators:    saved.showGeoIndicators    ?? cfg.showGeoIndicators    ?? true,
  showImageIndicators:  saved.showImageIndicators  ?? cfg.showImageIndicators  ?? true,
  ancestorPulse:        saved.ancestorPulse       ?? cfg.ancestorPulse       ?? true,
  showRootPath:         saved.showRootPath        ?? cfg.showRootPath        ?? false,
  topicFilter: cfg.topicFilter ?? "#",
  graphStructureVersion: 0,
  exportRequested: 0,
  selectedNodeId: null,
  highlightedNodes: new Map<string, string>(),
  burstWindowActive: false,
  burstSettingsLocked: false,

  handleMessage: (topic: string, payload: string, qos: 0 | 1 | 2, retain = false, userProperties?: MqttUserProperties, imageBlobUrl?: string) => {
    perfMark("handle-msg-start");
    const state = get();

    // Fully drop retained messages during the post-subscribe burst window.
    // No node creation, no counters, no visual effects — the message is
    // silently ignored so the graph doesn't explode with stale retained data.
    const inBurstWindow = _burstWindowStart > 0
      && (Date.now() - _burstWindowStart < state.burstWindowDuration);
    if (state.dropRetainedBurst && retain && inBurstWindow) {
      if (imageBlobUrl) URL.revokeObjectURL(imageBlobUrl);
      return;
    }

    const root = state.root;
    const { node, newNodes } = ensureTopicPathTracked(root, topic);

    node.messageCount += 1;
    node.lastTimestamp = Date.now();
    node.lastQoS = qos;
    node.lastUserProperties = userProperties ?? null;

    // Track payload sizes unconditionally — independent of tooltip/LRU settings
    // so size history is always available for debugging and WebMCP queries.
    node.lastPayloadSize = payload.length;
    node.largestPayloadSize = Math.max(node.largestPayloadSize, payload.length);

    // Store image blob URL — revoke the previous one to prevent memory leaks.
    if (imageBlobUrl) {
      if (node.lastImageBlobUrl) URL.revokeObjectURL(node.lastImageBlobUrl);
      node.lastImageBlobUrl = imageBlobUrl;
    }

    // Only store payloads when tooltips are enabled (opt-in).
    // Use LRU eviction to cap the number of stored payloads.
    if (state.showTooltips) {
      // The selected node bypasses truncation so the DetailPanel can show
      // the full payload and JSON pretty-print works for large objects.
      const isSelected = node.id === state.selectedNodeId;
      node.lastPayload = (!isSelected && payload.length > PAYLOAD_MAX_STORE)
        ? payload.slice(0, PAYLOAD_MAX_STORE)
        : payload;

      // Move this node to the most-recent position in the LRU set
      _payloadLru.delete(node.id);
      _payloadLru.add(node.id);

      // Evict the oldest entry if over the cap.
      // Skip the selected node — it is pinned for the duration of selection.
      if (_payloadLru.size > PAYLOAD_LRU_CAP) {
        const selectedId = state.selectedNodeId;
        for (const candidateId of _payloadLru) {
          if (candidateId === selectedId) continue;
          _payloadLru.delete(candidateId);
          const segments = candidateId === "" ? [] : candidateId.split("/");
          const evicted = findNode(root, segments);
          if (evicted) {
            evicted.lastPayload = null;
            // Revoke blob URL on eviction to free memory
            if (evicted.lastImageBlobUrl) {
              URL.revokeObjectURL(evicted.lastImageBlobUrl);
              evicted.lastImageBlobUrl = null;
            }
          }
          break;
        }
      }
    }

    // Submit payload for off-thread analysis (geo detection, image detection,
    // etc.).  Every non-empty payload is submitted — the 500ms per-node
    // debounce in payloadAnalyzerService prevents flooding the worker on
    // high-frequency topics.  Results are merged (not replaced) in
    // setPayloadTags, so tags from different payload types coexist.
    if (payload.length > 0) {
      payloadAnalyzer.analyze(node.id, payload);
    }

    // Instant rate spike: add 1 message worth of rate contribution
    // The EMA decay will smooth this out over subsequent ticks
    node.messageRate += 1;

    // Snapshot the peak rate at pulse time for fade colour interpolation.
    // This value persists so the renderer can fade from a meaningful warm
    // colour even after EMA decay has pulled messageRate back toward zero.
    node.pulseRate = node.messageRate;

    // Propagate pulse timestamp up the ancestor chain if enabled
    if (state.ancestorPulse) {
      const now = node.lastTimestamp;
      const ancestorPaths = getAncestorPaths(topic);
      for (const path of ancestorPaths) {
        // Look up existing ancestor node by walking the tree (don't create new nodes)
        const segments = path === "" ? [] : path.split("/");
        let ancestor: TopicNode | undefined = root;
        for (const seg of segments) {
          ancestor = ancestor.children.get(seg);
          if (!ancestor) break;
        }
        if (ancestor) {
          ancestor.lastTimestamp = now;
          // Snapshot aggregate rate for ancestor fade colour.
          // Use max(..., 1) because bottom-up aggregation hasn't run yet
          // for this tick, so aggregateRate may be stale. The 1 guarantees
          // at least a visible warm colour ("something happened in my subtree").
          ancestor.pulseRate = Math.max(ancestor.aggregateRate, 1);
        }
      }
    }

    // Accumulate counter deltas — flushed in the rAF callback alongside the graph rebuild.
    // This collapses N Zustand set() calls per frame (one per message) into 1,
    // eliminating per-message React re-render notifications for the status bar counters.
    _pendingMessages += 1;
    _pendingNewTopics += newNodes;

    // Schedule a batched graph rebuild instead of rebuilding immediately.
    // Multiple messages within the same animation frame are coalesced into one rebuild.
    get().scheduleRebuild(newNodes > 0);

    perfMark("handle-msg-end");
    perfMeasure("handle-message", "handle-msg-start", "handle-msg-end");
  },

  setConnectionStatus: (status: ConnectionStatus, error?: string) => {
    // Start burst throttle window on successful connection.
    // The first ~10 s of retained messages will have structural rebuilds
    // throttled to reduce CPU/visual chaos.
    if (status === "connected") {
      _burstWindowStart = Date.now();
      _lastStructuralFlush = 0;
    }

    // Burst UI state — lock settings and show indicator when drop is enabled.
    const burstUpdates: Partial<TopicStoreState> = {};
    if (status === "connected") {
      const state = get();
      if (state.dropRetainedBurst) {
        burstUpdates.burstWindowActive = true;
        burstUpdates.burstSettingsLocked = true;
        // Clear any stale timer from a previous connection
        if (_burstActiveTimeoutId !== null) clearTimeout(_burstActiveTimeoutId);
        _burstActiveTimeoutId = setTimeout(() => {
          _burstActiveTimeoutId = null;
          set({ burstWindowActive: false });
        }, state.burstWindowDuration);
      }
    } else if (status === "disconnected") {
      // Unlock settings and clear indicator on disconnect
      burstUpdates.burstWindowActive = false;
      burstUpdates.burstSettingsLocked = false;
      if (_burstActiveTimeoutId !== null) {
        clearTimeout(_burstActiveTimeoutId);
        _burstActiveTimeoutId = null;
      }
    }

    set({
      connectionStatus: status,
      // Preserve the last error message across reconnect-loop status changes
      // ("close" → "disconnected", "reconnect" → "connecting") so the user
      // doesn't see it flicker off every 5 seconds.
      // Only clear it on successful connection or when a new error arrives.
      // Empty string is used as an explicit "clear error" signal (e.g. user disconnect).
      // undefined means "no update" — preserve the last error across reconnect loops.
      errorMessage: error !== undefined
        ? (error || null)                // new error or explicit clear ("" → null)
        : status === "connected"
          ? null                         // success — clear
          : get().errorMessage,          // all other transitions — preserve
      ...(status === "connected" ? { sessionStart: Date.now() } : {}),
      ...burstUpdates,
    });
  },

  decayTick: () => {
    perfMark("decay-tick-start");
    const state = get();
    const root = state.root;
    const dt = DECAY_INTERVAL / 1000; // seconds
    const alpha = 1 - Math.exp(-dt / state.emaTau);

    // Decay all nodes' rates and propagate aggregates bottom-up
    function decayNode(node: TopicNode): number {
      // Decay this node's direct rate toward zero
      // Target is 0 (no new messages), EMA pulls toward target
      node.messageRate = node.messageRate * (1 - alpha);

      // Clamp very small values to zero to avoid floating-point noise
      if (node.messageRate < 0.001) {
        node.messageRate = 0;
      }

      // Recurse into children and sum their aggregate rates
      let childAggregateSum = 0;
      for (const child of node.children.values()) {
        childAggregateSum += decayNode(child);
      }

      node.aggregateRate = node.messageRate + childAggregateSum;
      return node.aggregateRate;
    }

    decayNode(root);

    // Prune stale nodes (if enabled).
    // After the retained-message burst on initial subscribe, many topics may
    // never publish again. Pruning removes them after pruneTimeout ms so the
    // graph converges on the live topic tree.
    const pruneTimeout = state.pruneTimeout;
    if (pruneTimeout > 0) {
      const now = Date.now();
      const selectedId = state.selectedNodeId;

      /** Bottom-up walk: returns true if the caller should delete this child. */
      function pruneNode(node: TopicNode): boolean {
        // Recurse children first — deepest nodes pruned before parents
        for (const [segment, child] of node.children) {
          if (pruneNode(child)) {
            node.children.delete(segment);
          }
        }
        // Never prune the root or the currently selected node
        if (node.id === "" || node.id === selectedId) return false;
        // Only prune leaf nodes (children already cleaned up above)
        if (node.children.size > 0) return false;
        // Prune if: received messages but now stale, OR never received
        // any message directly (implicit ancestor, now childless)
        const isStale = node.lastTimestamp > 0 && now - node.lastTimestamp > pruneTimeout;
        const isImplicitLeaf = node.messageCount === 0;
        return isStale || isImplicitLeaf;
      }

      pruneNode(root);
    }

    // Pulse duration equals tau in milliseconds — "Fade Time = 5s" means 5s fade
    const pulseDuration = state.emaTau * 1000;

    // Skip rebuilding graph data if a structural rAF rebuild is already pending.
    // The rAF callback will call buildGraphData() + set() moments later, so doing
    // it here too is pure duplicate work during a burst. Rate decay above has
    // already run (the tree is updated), which is what matters for correctness.
    if (!(_rebuildScheduled && _rebuildStructural)) {
      const { graphNodes, graphLinks } = buildGraphData(
        root, pulseDuration, state.showRootPath, state.topicFilter, state.ancestorPulse, state.nodeScale
      );
      set({ graphNodes, graphLinks });
    }

    perfMark("decay-tick-end");
    perfStats.lastDecayTickMs = perfMeasure("decay-tick", "decay-tick-start", "decay-tick-end");
  },

  rebuildGraph: () => {
    // Cancel any pending rAF and clear the scheduling flags.
    // rebuildGraph() is the synchronous stand-in for the rAF callback used in tests,
    // so it must fully replicate what the rAF callback does — including clearing the
    // flags so that a subsequent decayTick() can safely rebuild graph data.
    if (_rebuildRafId !== null) {
      cancelAnimationFrame(_rebuildRafId);
      _rebuildRafId = null;
    }
    if (_burstThrottleId !== null) {
      clearTimeout(_burstThrottleId);
      _burstThrottleId = null;
    }
    const wasStructural = _rebuildStructural;
    _rebuildScheduled = false;
    _rebuildStructural = false;

    const state = get();
    const pulseDuration = state.emaTau * 1000;
    const { graphNodes, graphLinks } = buildGraphData(
      state.root, pulseDuration, state.showRootPath, state.topicFilter, state.ancestorPulse, state.nodeScale
    );
    // Also drain any pending counter deltas (mirrors the rAF callback behaviour).
    // This ensures tests that call rebuildGraph() as a synchronous rAF stand-in
    // see correct totalMessages/totalTopics values immediately.
    const pendingMsgs = _pendingMessages;
    const pendingTopics = _pendingNewTopics;
    _pendingMessages = 0;
    _pendingNewTopics = 0;
    set({
      graphNodes,
      graphLinks,
      ...(wasStructural
        ? { graphStructureVersion: state.graphStructureVersion + 1 }
        : {}),
      totalMessages: state.totalMessages + pendingMsgs,
      totalTopics: state.totalTopics + pendingTopics,
    });
  },

  scheduleRebuild: (structural: boolean) => {
    // Accumulate: if any call in the batch is structural, the flush is structural
    if (structural) _rebuildStructural = true;

    // Burst throttle: during the first BURST_WINDOW_MS after connection,
    // defer structural rebuilds so they fire at most once every
    // BURST_STRUCTURAL_INTERVAL_MS.  This reduces the number of expensive
    // D3 data joins from ~600 to ~40 during a retained-message flood.
    const now = Date.now();
    const inBurstWindow = _burstWindowStart > 0
      && now - _burstWindowStart < BURST_WINDOW_MS;

    if (inBurstWindow && _rebuildStructural) {
      const elapsed = now - _lastStructuralFlush;
      if (elapsed < BURST_STRUCTURAL_INTERVAL_MS) {
        // Too soon since last structural flush — schedule a deferred retry
        if (_burstThrottleId === null) {
          _burstThrottleId = setTimeout(() => {
            _burstThrottleId = null;
            // Re-enter to trigger the normal rAF path
            get().scheduleRebuild(false);
          }, BURST_STRUCTURAL_INTERVAL_MS - elapsed);
        }
        return;
      }
    }

    if (!_rebuildScheduled) {
      _rebuildScheduled = true;
      _rebuildRafId = requestAnimationFrame(() => {
        perfMark("rebuild-start");
        _rebuildScheduled = false;
        _rebuildRafId = null;
        const wasStructural = _rebuildStructural;
        _rebuildStructural = false;

        const s = get();
        const pulseDuration = s.emaTau * 1000;
        const { graphNodes, graphLinks } = buildGraphData(
          s.root, pulseDuration, s.showRootPath, s.topicFilter, s.ancestorPulse, s.nodeScale
        );

        // Drain accumulated counter deltas and fold into this single set() call.
        // This collapses N per-message set() calls into 1 per animation frame.
        const pendingMsgs = _pendingMessages;
        const pendingTopics = _pendingNewTopics;
        _pendingMessages = 0;
        _pendingNewTopics = 0;

        set({
          graphNodes,
          graphLinks,
          // Only bump version when structure actually changed (new/removed nodes)
          graphStructureVersion: wasStructural
            ? s.graphStructureVersion + 1
            : s.graphStructureVersion,
          totalMessages: s.totalMessages + pendingMsgs,
          totalTopics: s.totalTopics + pendingTopics,
        });

        if (wasStructural) {
          _lastStructuralFlush = Date.now();
        }

        perfMark("rebuild-end");
        perfMeasure("rebuild", "rebuild-start", "rebuild-end");
      });
    }
  },

  reset: () => {
    // Cancel any pending scheduled rebuild
    if (_rebuildRafId !== null) {
      cancelAnimationFrame(_rebuildRafId);
      _rebuildRafId = null;
      _rebuildScheduled = false;
      _rebuildStructural = false;
    }
    // Cancel any pending burst throttle timer
    if (_burstThrottleId !== null) {
      clearTimeout(_burstThrottleId);
      _burstThrottleId = null;
    }
    // Cancel burst active indicator timer
    if (_burstActiveTimeoutId !== null) {
      clearTimeout(_burstActiveTimeoutId);
      _burstActiveTimeoutId = null;
    }
    _burstWindowStart = 0;
    _lastStructuralFlush = 0;
    // Revoke all image blob URLs to prevent memory leaks on reset
    revokeAllBlobUrls(get().root);
    _payloadLru.clear();
    _pendingMessages = 0;
    _pendingNewTopics = 0;
    // Preserve user's saved visual settings across resets (e.g. on reconnect).
    // reset() clears topic tree data but must not discard localStorage settings.
    const savedForReset = loadSavedSettings();
    set({
      root: createTopicNode("", ""),
      graphNodes: [],
      graphLinks: [],
      totalMessages: 0,
      totalTopics: 0,
      sessionStart: Date.now(),
      errorMessage: null,
      graphStructureVersion: 0,
      nodeScale: savedForReset.nodeScale ?? cfg.nodeScale ?? 1.0,
      scaleNodeSizeByDepth: savedForReset.scaleNodeSizeByDepth ?? cfg.scaleNodeSizeByDepth ?? true,
      selectedNodeId: null,
      highlightedNodes: new Map<string, string>(),
      burstWindowActive: false,
      burstSettingsLocked: false,
    });
  },

  resetSettings: () => {
    const tooltipsWillDisable = !(cfg.showTooltips ?? true);
    // If tooltips are being turned off, clear payload LRU (matches setShowTooltips behaviour)
    if (tooltipsWillDisable && get().showTooltips) {
      const root = get().root;
      for (const nodeId of _payloadLru) {
        const segments = nodeId === "" ? [] : nodeId.split("/");
        const node = findNode(root, segments);
        if (node) node.lastPayload = null;
      }
      _payloadLru.clear();
    }
    set({
      emaTau: cfg.emaTau ?? DEFAULT_EMA_TAU,
      showLabels: cfg.showLabels ?? true,
      labelDepthFactor: cfg.labelDepthFactor ?? 2,
      labelMode: (cfg.labelMode === "depth" || cfg.labelMode === "zoom" ? cfg.labelMode : "activity") as LabelMode,
      labelFontSize: cfg.labelFontSize ?? 15,
      labelStrokeWidth: cfg.labelStrokeWidth ?? 9.0,
      scaleTextByDepth: cfg.scaleTextByDepth ?? true,
      showTooltips: cfg.showTooltips ?? true,
      nodeScale: cfg.nodeScale ?? 2.5,
      scaleNodeSizeByDepth: cfg.scaleNodeSizeByDepth ?? true,
      repulsionStrength: cfg.repulsionStrength ?? -350,
      linkDistance: cfg.linkDistance ?? 155,
      linkStrength: cfg.linkStrength ?? 0.3,
      collisionPadding: cfg.collisionPadding ?? 13,
      alphaDecay: cfg.alphaDecay ?? 0.01,
      pruneTimeout: cfg.pruneTimeout ?? 0,
      dropRetainedBurst: cfg.dropRetainedBurst ?? true,
      burstWindowDuration: cfg.burstWindowDuration ?? 5_000,
      showGeoIndicators: cfg.showGeoIndicators ?? true,
      showImageIndicators: cfg.showImageIndicators ?? true,
      ancestorPulse: cfg.ancestorPulse ?? true,
      showRootPath: cfg.showRootPath ?? false,
    });
    // Clear localStorage overrides so the reset truly returns to config.json defaults.
    clearSavedSettings();
    // Rebuild graph for nodeScale and showRootPath side effects
    get().rebuildGraph();
  },

  setEmaTau: (tau: number) => {
    set({ emaTau: tau });
    persistSettings({ emaTau: tau });
  },

  setShowLabels: (show: boolean) => {
    set({ showLabels: show });
    persistSettings({ showLabels: show });
  },
  setLabelDepthFactor: (factor: number) => {
    set({ labelDepthFactor: factor });
    persistSettings({ labelDepthFactor: factor });
  },
  setLabelMode: (mode: LabelMode) => {
    set({ labelMode: mode });
    persistSettings({ labelMode: mode });
  },
  setLabelFontSize: (size: number) => {
    set({ labelFontSize: size });
    persistSettings({ labelFontSize: size });
  },
  setLabelStrokeWidth: (width: number) => {
    set({ labelStrokeWidth: width });
    persistSettings({ labelStrokeWidth: width });
  },
  setScaleTextByDepth: (enabled: boolean) => {
    set({ scaleTextByDepth: enabled });
    persistSettings({ scaleTextByDepth: enabled });
  },
  setShowTooltips: (show: boolean) => {
    set({ showTooltips: show });
    persistSettings({ showTooltips: show });
    // When disabling tooltips, clear all stored payloads to free memory
    if (!show) {
      const root = get().root;
      for (const nodeId of _payloadLru) {
        const segments = nodeId === "" ? [] : nodeId.split("/");
        const node = findNode(root, segments);
        if (node) node.lastPayload = null;
      }
      _payloadLru.clear();
    }
  },

  setNodeScale: (scale: number) => {
    set({ nodeScale: scale });
    persistSettings({ nodeScale: scale });
    // Rebuild graph so node radii update immediately
    get().rebuildGraph();
  },
  setScaleNodeSizeByDepth: (enabled: boolean) => {
    set({ scaleNodeSizeByDepth: enabled });
    persistSettings({ scaleNodeSizeByDepth: enabled });
  },

  setRepulsionStrength: (value: number) => {
    set({ repulsionStrength: value });
    persistSettings({ repulsionStrength: value });
  },
  setLinkDistance: (value: number) => {
    set({ linkDistance: value });
    persistSettings({ linkDistance: value });
  },
  setLinkStrength: (value: number) => {
    set({ linkStrength: value });
    persistSettings({ linkStrength: value });
  },
  setCollisionPadding: (value: number) => {
    set({ collisionPadding: value });
    persistSettings({ collisionPadding: value });
  },
  setAlphaDecay: (value: number) => {
    set({ alphaDecay: value });
    persistSettings({ alphaDecay: value });
  },
  setPruneTimeout: (value: number) => {
    set({ pruneTimeout: value });
    persistSettings({ pruneTimeout: value });
  },
  setDropRetainedBurst: (enabled: boolean) => {
    set({ dropRetainedBurst: enabled });
    persistSettings({ dropRetainedBurst: enabled });
  },
  setBurstWindowDuration: (value: number) => {
    set({ burstWindowDuration: value });
    persistSettings({ burstWindowDuration: value });
  },
  setShowGeoIndicators: (enabled: boolean) => {
    set({ showGeoIndicators: enabled });
    persistSettings({ showGeoIndicators: enabled });
  },
  setShowImageIndicators: (enabled: boolean) => {
    set({ showImageIndicators: enabled });
    persistSettings({ showImageIndicators: enabled });
  },
  setAncestorPulse: (enabled: boolean) => {
    set({ ancestorPulse: enabled });
    persistSettings({ ancestorPulse: enabled });
  },
  setShowRootPath: (enabled: boolean) => {
    set({ showRootPath: enabled });
    persistSettings({ showRootPath: enabled });
    // Rebuild graph immediately so the change is visible
    get().rebuildGraph();
  },
  setTopicFilter: (filter: string) => {
    set({ topicFilter: filter });
  },
  requestExport: () => {
    set({ exportRequested: get().exportRequested + 1 });
  },
  setSelectedNodeId: (id: string | null) => {
    set({ selectedNodeId: id });
  },
  setHighlightedNodes: (nodes: Map<string, string>) => {
    // Enforce cap: keep only the first MAX_HIGHLIGHTED_NODES entries
    let capped = nodes;
    if (nodes.size > MAX_HIGHLIGHTED_NODES) {
      capped = new Map<string, string>();
      let count = 0;
      for (const [id, color] of nodes) {
        if (count >= MAX_HIGHLIGHTED_NODES) break;
        capped.set(id, color);
        count++;
      }
    }
    set({ highlightedNodes: capped });
  },
  clearHighlights: () => {
    set({ highlightedNodes: new Map<string, string>() });
  },
  setPayloadTags: (nodeId: string, tags: DetectorResult[]) => {
    const root = get().root;
    const segments = nodeId === "" ? [] : nodeId.split("/");
    const node = findNode(root, segments);
    if (node) {
      // Merge new tags with existing tags: new tags replace existing tags of
      // the same type, while existing tags of types not present in the new
      // results are preserved.  This prevents e.g. an image analysis result
      // from wiping a previously detected geo tag (and vice versa).
      const newTagTypes = new Set(tags.map((t) => t.tag));
      const preserved = node.payloadTags?.filter((t) => !newTagTypes.has(t.tag)) ?? [];
      node.payloadTags = [...preserved, ...tags];
      // Schedule a non-structural rebuild so graphNodes picks up the new tags
      // and React re-renders components that depend on payloadTags.
      get().scheduleRebuild(false);
    }
  },
};});

// Wire up the payload analyzer worker callback to the store.
// When the worker finishes analyzing a payload, it posts results here.
payloadAnalyzer.onResult((nodeId, tags) => {
  useTopicStore.getState().setPayloadTags(nodeId, tags);
});

/** Start the periodic decay timer. Returns a cleanup function. */
export function startDecayTimer(): () => void {
  const interval = setInterval(() => {
    useTopicStore.getState().decayTick();
  }, DECAY_INTERVAL);

  return () => clearInterval(interval);
}
