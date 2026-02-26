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
} from "../utils/topicParser";
import { calculateRadius } from "../utils/sizeCalculator";

/** EMA time constant in seconds. Controls how quickly rates respond. */
const EMA_TAU = 5;

/** Decay interval in milliseconds. */
const DECAY_INTERVAL = 500;

/** Duration in ms that a node's pulse flag stays active. */
const PULSE_DURATION = 600;

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
}

function buildGraphData(root: TopicNode): {
  graphNodes: GraphNode[];
  graphLinks: GraphLink[];
} {
  const flat = flattenTree(root);
  const allNodes = collectAllNodes(root);
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
      radius: calculateRadius(tn.aggregateRate),
      messageRate: tn.messageRate,
      aggregateRate: tn.aggregateRate,
      depth: f.depth,
      pulse: now - tn.lastTimestamp < PULSE_DURATION,
      pulseTimestamp: tn.lastTimestamp,
    };
  });

  const graphLinks: GraphLink[] = flat
    .filter((f) => f.parentId !== null)
    .map((f) => ({
      source: f.parentId!,
      target: f.nodeId,
    }));

  return { graphNodes, graphLinks };
}

export const useTopicStore = create<TopicStoreState>((set, get) => ({
  root: createTopicNode("", ""),
  graphNodes: [],
  graphLinks: [],
  connectionStatus: "disconnected",
  totalMessages: 0,
  totalTopics: 0,
  sessionStart: Date.now(),
  errorMessage: null,

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

    const newTotalTopics = countNodes(root) - 1; // exclude root

    set({
      totalMessages: state.totalMessages + 1,
      totalTopics: newTotalTopics,
    });
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
    const alpha = 1 - Math.exp(-dt / EMA_TAU);

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

    // Rebuild flat graph data
    const { graphNodes, graphLinks } = buildGraphData(root);
    set({ graphNodes, graphLinks });
  },

  rebuildGraph: () => {
    const { root } = get();
    const { graphNodes, graphLinks } = buildGraphData(root);
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
}));

/** Start the periodic decay timer. Returns a cleanup function. */
export function startDecayTimer(): () => void {
  const interval = setInterval(() => {
    useTopicStore.getState().decayTick();
  }, DECAY_INTERVAL);

  return () => clearInterval(interval);
}
