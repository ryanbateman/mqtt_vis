import { create } from "zustand";
import type {
  TopicNode,
  ConnectionStatus,
  GraphNode,
  GraphLink,
} from "../types";
import {
  createTopicNode,
  ensureTopicPath,
  flattenTree,
  collectAllNodes,
  countNodes,
  getAncestorPaths,
  getFixedPrefix,
  findNode,
} from "../utils/topicParser";
import { calculateRadius } from "../utils/sizeCalculator";
import { getConfig } from "../utils/config";

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
  /** Controls how many tree depths of labels are visible at a given zoom level. */
  labelDepthFactor: number;

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
  /** Whether ancestor nodes pulse when a descendant receives a message. */
  ancestorPulse: boolean;
  /** Whether to show the structural root-path nodes above the subscription prefix. */
  showRootPath: boolean;
  /** The current MQTT subscription topic filter. */
  topicFilter: string;

  /** Toggle ancestor pulse behaviour. */
  setAncestorPulse: (enabled: boolean) => void;
  /** Toggle root path node visibility. */
  setShowRootPath: (enabled: boolean) => void;
  /** Store the current topic filter (called on connect). */
  setTopicFilter: (filter: string) => void;

  /** Process an incoming MQTT message. */
  handleMessage: (topic: string, payload: string, qos: 0 | 1 | 2) => void;
  /** Update connection status. */
  setConnectionStatus: (status: ConnectionStatus, error?: string) => void;
  /** Run one decay tick — called periodically. */
  decayTick: () => void;
  /** Rebuild the flat graph data from the tree. */
  rebuildGraph: () => void;
  /** Reset the store (on disconnect). */
  reset: () => void;
  /** Update the EMA time constant. */
  setEmaTau: (tau: number) => void;
  /** Update the label depth factor. */
  setLabelDepthFactor: (factor: number) => void;
  /** Update simulation parameters. */
  setRepulsionStrength: (value: number) => void;
  setLinkDistance: (value: number) => void;
  setLinkStrength: (value: number) => void;
  setCollisionPadding: (value: number) => void;
  setAlphaDecay: (value: number) => void;
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
  ancestorPulse: boolean
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
    return {
      id: f.nodeId,
      label: f.label,
      radius: calculateRadius(ancestorPulse ? tn.aggregateRate : tn.messageRate),
      messageRate: tn.messageRate,
      aggregateRate: tn.aggregateRate,
      depth: f.depth,
      pulse: now - tn.lastTimestamp < pulseDuration,
      pulseTimestamp: tn.lastTimestamp,
      pulseRate: tn.pulseRate,
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

export const useTopicStore = create<TopicStoreState>((set, get) => {
  const cfg = getConfig();
  return {
  root: createTopicNode("", ""),
  graphNodes: [],
  graphLinks: [],
  connectionStatus: "disconnected",
  totalMessages: 0,
  totalTopics: 0,
  sessionStart: Date.now(),
  errorMessage: null,
  emaTau: cfg.emaTau ?? DEFAULT_EMA_TAU,
  labelDepthFactor: cfg.labelDepthFactor ?? 5,
  repulsionStrength: cfg.repulsionStrength ?? -350,
  linkDistance: cfg.linkDistance ?? 155,
  linkStrength: cfg.linkStrength ?? 0.5,
  collisionPadding: cfg.collisionPadding ?? 13,
  alphaDecay: cfg.alphaDecay ?? 0.01,
  ancestorPulse: cfg.ancestorPulse ?? true,
  showRootPath: cfg.showRootPath ?? false,
  topicFilter: cfg.topicFilter ?? "#",

  handleMessage: (topic: string, payload: string, qos: 0 | 1 | 2) => {
    const state = get();
    const root = state.root;
    const node = ensureTopicPath(root, topic);

    node.messageCount += 1;
    node.lastPayload = payload;
    node.lastTimestamp = Date.now();
    node.lastQoS = qos;

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

    const newTotalTopics = countNodes(root) - 1; // exclude root

    set({
      totalMessages: state.totalMessages + 1,
      totalTopics: newTotalTopics,
    });

    // Rebuild graph immediately so the renderer gets fresh pulseTimestamp
    // and pulseRate data without waiting for the next decayTick (500ms).
    get().rebuildGraph();
  },

  setConnectionStatus: (status: ConnectionStatus, error?: string) => {
    set({
      connectionStatus: status,
      errorMessage: error ?? null,
      ...(status === "connected" ? { sessionStart: Date.now() } : {}),
    });
  },

  decayTick: () => {
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

    // Pulse duration equals tau in milliseconds — "Fade Time = 5s" means 5s fade
    const pulseDuration = state.emaTau * 1000;

    // Rebuild flat graph data (decay always runs on full tree, but rendering may skip prefix)
    const { graphNodes, graphLinks } = buildGraphData(
      root, pulseDuration, state.showRootPath, state.topicFilter, state.ancestorPulse
    );
    set({ graphNodes, graphLinks });
  },

  rebuildGraph: () => {
    const state = get();
    const pulseDuration = state.emaTau * 1000;
    const { graphNodes, graphLinks } = buildGraphData(
      state.root, pulseDuration, state.showRootPath, state.topicFilter, state.ancestorPulse
    );
    set({ graphNodes, graphLinks });
  },

  reset: () => {
    set({
      root: createTopicNode("", ""),
      graphNodes: [],
      graphLinks: [],
      totalMessages: 0,
      totalTopics: 0,
      sessionStart: Date.now(),
      errorMessage: null,
    });
  },

  setEmaTau: (tau: number) => {
    set({ emaTau: tau });
  },

  setLabelDepthFactor: (factor: number) => {
    set({ labelDepthFactor: factor });
  },

  setRepulsionStrength: (value: number) => {
    set({ repulsionStrength: value });
  },
  setLinkDistance: (value: number) => {
    set({ linkDistance: value });
  },
  setLinkStrength: (value: number) => {
    set({ linkStrength: value });
  },
  setCollisionPadding: (value: number) => {
    set({ collisionPadding: value });
  },
  setAlphaDecay: (value: number) => {
    set({ alphaDecay: value });
  },
  setAncestorPulse: (enabled: boolean) => {
    set({ ancestorPulse: enabled });
  },
  setShowRootPath: (enabled: boolean) => {
    set({ showRootPath: enabled });
    // Rebuild graph immediately so the change is visible
    get().rebuildGraph();
  },
  setTopicFilter: (filter: string) => {
    set({ topicFilter: filter });
  },
};});

/** Start the periodic decay timer. Returns a cleanup function. */
export function startDecayTimer(): () => void {
  const interval = setInterval(() => {
    useTopicStore.getState().decayTick();
  }, DECAY_INTERVAL);

  return () => clearInterval(interval);
}
