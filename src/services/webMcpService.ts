/**
 * WebMCP integration — registers tools with the browser's navigator.modelContext API.
 *
 * This exposes the MQTT visualiser's data and controls as structured tools for
 * browser-integrated AI agents (Chrome 146+ with WebMCP flag). The page acts as
 * an MCP server running entirely client-side.
 *
 * See: https://webmachinelearning.github.io/webmcp/
 */

import type { TopicNode } from "../types";
import { useTopicStore } from "../stores/topicStore";
import { findNode } from "../utils/topicParser";
import { getConfig } from "../utils/config";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Whether tools have been registered (to avoid double-registration). */
let registered = false;

/** Names of all registered tools (for cleanup). */
const registeredToolNames: string[] = [];

/**
 * Recursively serialise a TopicNode subtree into a plain object.
 * Caps recursion at `maxDepth` to avoid enormous payloads on large trees.
 */
function serialiseTree(
  node: TopicNode,
  currentDepth: number,
  maxDepth: number,
): Record<string, unknown> {
  const childCount = node.children.size;
  const result: Record<string, unknown> = {
    id: node.id || "(root)",
    segment: node.segment || "(root)",
    messageRate: Math.round(node.messageRate * 1000) / 1000,
    aggregateRate: Math.round(node.aggregateRate * 1000) / 1000,
    messageCount: node.messageCount,
    childCount,
    depth: currentDepth,
  };

  if (currentDepth < maxDepth && childCount > 0) {
    const children: Record<string, unknown>[] = [];
    for (const child of node.children.values()) {
      children.push(serialiseTree(child, currentDepth + 1, maxDepth));
    }
    result.children = children;
  }

  return result;
}

/**
 * Find a TopicNode by its full topic path string.
 * Returns undefined if not found.
 */
function findTopicByPath(topicId: string): TopicNode | undefined {
  const root = useTopicStore.getState().root;
  if (!topicId || topicId === "(root)") return root;
  const segments = topicId.split("/");
  return findNode(root, segments);
}

// ── Tool execute functions ───────────────────────────────────────────────────

async function executeGetTopicTree(
  input: Record<string, unknown>,
): Promise<unknown> {
  const maxDepth =
    typeof input.maxDepth === "number" && input.maxDepth > 0
      ? input.maxDepth
      : 5;
  const root = useTopicStore.getState().root;
  return serialiseTree(root, 0, maxDepth);
}

async function executeGetActiveTopics(
  input: Record<string, unknown>,
): Promise<unknown> {
  const minRate =
    typeof input.minRate === "number" ? input.minRate : 0;
  const limit =
    typeof input.limit === "number" && input.limit > 0 ? input.limit : 20;

  const { graphNodes } = useTopicStore.getState();
  return graphNodes
    .filter((n) => n.messageRate > minRate)
    .sort((a, b) => b.messageRate - a.messageRate)
    .slice(0, limit)
    .map((n) => ({
      id: n.id,
      messageRate: Math.round(n.messageRate * 1000) / 1000,
      aggregateRate: Math.round(n.aggregateRate * 1000) / 1000,
      messageCount: findTopicByPath(n.id)?.messageCount ?? 0,
      lastTimestamp: findTopicByPath(n.id)?.lastTimestamp ?? 0,
    }));
}

async function executeFindTopics(
  input: Record<string, unknown>,
): Promise<unknown> {
  const pattern =
    typeof input.pattern === "string" ? input.pattern.toLowerCase() : "";
  const minRate =
    typeof input.minRate === "number" ? input.minRate : 0;
  const minDepth =
    typeof input.minDepth === "number" ? input.minDepth : 0;
  const maxDepth =
    typeof input.maxDepth === "number" ? input.maxDepth : Infinity;

  const { graphNodes } = useTopicStore.getState();
  return graphNodes
    .filter((n) => {
      if (pattern && !n.id.toLowerCase().includes(pattern)) return false;
      if (n.messageRate < minRate) return false;
      if (n.depth < minDepth || n.depth > maxDepth) return false;
      return true;
    })
    .map((n) => ({
      id: n.id,
      messageRate: Math.round(n.messageRate * 1000) / 1000,
      aggregateRate: Math.round(n.aggregateRate * 1000) / 1000,
      messageCount: findTopicByPath(n.id)?.messageCount ?? 0,
      depth: n.depth,
    }));
}

async function executeGetTopicDetails(
  input: Record<string, unknown>,
): Promise<unknown> {
  const topicId = typeof input.topicId === "string" ? input.topicId : "";
  if (!topicId) {
    return { error: "topicId is required" };
  }

  const node = findTopicByPath(topicId);
  if (!node) {
    return { error: `Topic not found: ${topicId}` };
  }

  // Find matching GraphNode for depth info
  const graphNode = useTopicStore
    .getState()
    .graphNodes.find((n) => n.id === topicId);

  return {
    id: node.id,
    messageRate: Math.round(node.messageRate * 1000) / 1000,
    aggregateRate: Math.round(node.aggregateRate * 1000) / 1000,
    messageCount: node.messageCount,
    lastPayload: node.lastPayload,
    lastTimestamp: node.lastTimestamp,
    qos: node.lastQoS,
    depth: graphNode?.depth ?? 0,
    childCount: node.children.size,
  };
}

async function executeGetStats(): Promise<unknown> {
  const state = useTopicStore.getState();

  const topActiveTopics = [...state.graphNodes]
    .sort((a, b) => b.aggregateRate - a.aggregateRate)
    .slice(0, 10)
    .map((n) => ({
      id: n.id,
      aggregateRate: Math.round(n.aggregateRate * 1000) / 1000,
    }));

  return {
    totalMessages: state.totalMessages,
    totalTopics: state.totalTopics,
    uptimeMs: Date.now() - state.sessionStart,
    connectionStatus: state.connectionStatus,
    topActiveTopics,
  };
}

async function executeGetNoisyTopics(
  input: Record<string, unknown>,
): Promise<unknown> {
  const limit =
    typeof input.limit === "number" && input.limit > 0 ? input.limit : 10;
  const leafOnly = input.leafOnly === true;
  const mustHaveMessages = input.mustHaveMessages === true;

  const { graphNodes } = useTopicStore.getState();

  let nodes = [...graphNodes].sort((a, b) => b.aggregateRate - a.aggregateRate);

  if (leafOnly || mustHaveMessages) {
    nodes = nodes.filter((n) => {
      const topicNode = findTopicByPath(n.id);
      if (!topicNode) return false;
      if (leafOnly && topicNode.children.size > 0) return false;
      if (mustHaveMessages && topicNode.messageCount === 0) return false;
      return true;
    });
  }

  return nodes.slice(0, limit).map((n) => {
    const topicNode = findTopicByPath(n.id);
    return {
      id: n.id,
      messageRate: Math.round(n.messageRate * 1000) / 1000,
      aggregateRate: Math.round(n.aggregateRate * 1000) / 1000,
      messageCount: topicNode?.messageCount ?? 0,
    };
  });
}

async function executeExportGraph(): Promise<unknown> {
  useTopicStore.getState().requestExport();
  return { success: true, message: "Export triggered" };
}

/** Default highlight colour used when none is specified. */
const DEFAULT_HIGHLIGHT_COLOR = "#cc0000"; // fire-engine red

/** Basic hex colour validation — accepts #rgb and #rrggbb formats. */
function isValidHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

async function executeHighlightNodes(
  input: Record<string, unknown>,
): Promise<unknown> {
  const nodeIds = Array.isArray(input.nodeIds)
    ? (input.nodeIds as unknown[]).filter((id): id is string => typeof id === "string")
    : [];

  if (nodeIds.length === 0) {
    return { error: "nodeIds must be a non-empty array of topic path strings" };
  }

  const color =
    typeof input.color === "string" && isValidHexColor(input.color)
      ? input.color
      : DEFAULT_HIGHLIGHT_COLOR;

  const { graphNodes, setHighlightedNodes } = useTopicStore.getState();
  const knownIds = new Set(graphNodes.map((n) => n.id));

  // Only highlight nodes that exist in the current graph; skip unknowns silently
  const highlightMap = new Map<string, string>();
  const notFound: string[] = [];
  for (const id of nodeIds) {
    if (knownIds.has(id)) {
      highlightMap.set(id, color);
    } else {
      notFound.push(id);
    }
  }

  setHighlightedNodes(highlightMap);

  const result: Record<string, unknown> = {
    success: true,
    highlighted: highlightMap.size,
    color,
  };
  if (notFound.length > 0) {
    result.notFound = notFound;
    result.message = `Highlighted ${highlightMap.size} node(s). ${notFound.length} topic(s) not found in the current graph.`;
  } else {
    result.message = `Highlighted ${highlightMap.size} node(s).`;
  }
  return result;
}

async function executeClearHighlights(): Promise<unknown> {
  useTopicStore.getState().clearHighlights();
  return { success: true, message: "All highlights cleared" };
}

// ── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: ModelContextTool[] = [
  {
    name: "getTopicTree",
    description:
      "Get the MQTT topic tree structure with message rates and counts. " +
      "For large trees (1000+ topics), use maxDepth to limit the response size. " +
      "Defaults to maxDepth=5 if not specified.",
    inputSchema: {
      type: "object",
      properties: {
        maxDepth: {
          type: "number",
          description:
            "Maximum tree depth to return. Defaults to 5. " +
            "Child nodes beyond this depth are omitted but their existence " +
            "is indicated by the parent's childCount field.",
        },
      },
    },
    execute: executeGetTopicTree,
    annotations: { readOnlyHint: true },
  },
  {
    name: "getActiveTopics",
    description:
      "List topics that are currently receiving messages, sorted by direct message rate. " +
      "Use this to find which specific leaf topics are actively publishing right now. " +
      "For finding the busiest areas of the topic tree including aggregate subtree activity, " +
      "use getNoisyTopics instead.",
    inputSchema: {
      type: "object",
      properties: {
        minRate: {
          type: "number",
          description:
            "Minimum direct message rate (messages/sec) to include. Defaults to 0, " +
            "which excludes only truly idle topics.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of topics to return. Defaults to 20.",
        },
      },
    },
    execute: executeGetActiveTopics,
    annotations: { readOnlyHint: true },
  },
  {
    name: "findTopics",
    description:
      "Search for topics whose path contains the given substring (case-insensitive). " +
      "For example, pattern 'kitchen' matches 'home/kitchen/temp'. " +
      "Optionally filter by minimum message rate and depth range.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Substring to match against topic paths (case-insensitive).",
        },
        minRate: {
          type: "number",
          description:
            "Minimum direct message rate to include. Defaults to 0.",
        },
        minDepth: {
          type: "number",
          description: "Minimum tree depth to include. Defaults to 0.",
        },
        maxDepth: {
          type: "number",
          description:
            "Maximum tree depth to include. Defaults to no limit.",
        },
      },
    },
    execute: executeFindTopics,
    annotations: { readOnlyHint: true },
  },
  {
    name: "getTopicDetails",
    description:
      "Get detailed information about a specific MQTT topic including its current " +
      "message rate, aggregate rate, last payload, QoS level, and child count.",
    inputSchema: {
      type: "object",
      properties: {
        topicId: {
          type: "string",
          description:
            "Full topic path, e.g. 'home/kitchen/temp'. Required.",
        },
      },
      required: ["topicId"],
    },
    execute: executeGetTopicDetails,
    annotations: { readOnlyHint: true },
  },
  {
    name: "getStats",
    description:
      "Get aggregate MQTT traffic statistics for the current session including " +
      "total messages, unique topics, uptime, connection status, and the top 10 " +
      "most active topics by aggregate rate.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    execute: executeGetStats,
    annotations: { readOnlyHint: true },
  },
  {
    name: "getNoisyTopics",
    description:
      "List the highest-traffic areas of the topic tree, ranked by aggregate rate " +
      "(the node's own rate plus all descendants). Use this to find which branches " +
      "or subtrees are generating the most total traffic. For finding specific leaf " +
      "topics that are actively publishing, use getActiveTopics instead. " +
      "Use leafOnly=true to restrict results to leaf nodes (no children) — useful " +
      "for highlighting actual publishers rather than aggregate branch nodes. " +
      "Use mustHaveMessages=true to exclude structural intermediate nodes that have " +
      "never received a direct message on that exact topic path.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description:
            "Maximum number of topics to return. Defaults to 10.",
        },
        leafOnly: {
          type: "boolean",
          description:
            "If true, only return leaf nodes (nodes with no children). " +
            "Excludes intermediate branch nodes whose traffic is entirely " +
            "aggregated from descendants. Defaults to false.",
        },
        mustHaveMessages: {
          type: "boolean",
          description:
            "If true, only return nodes that have received at least one " +
            "message directly on that exact topic path (messageCount > 0). " +
            "Excludes structural intermediate nodes that exist only as " +
            "path segments and have never been published to directly. Defaults to false.",
        },
      },
    },
    execute: executeGetNoisyTopics,
    annotations: { readOnlyHint: true },
  },
  {
    name: "exportGraph",
    description:
      "Export the current graph visualisation as a PNG image. " +
      "This triggers a file download in the browser.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    execute: executeExportGraph,
    annotations: { readOnlyHint: false },
  },
  {
    name: "highlightNodes",
    description:
      "Highlight one or more nodes in the graph with a coloured ring. " +
      "Replaces any existing highlights — call again with a new set to update, " +
      "or use clearHighlights to remove all rings. " +
      "The highlight ring appears just outside the node circle and is visible " +
      "alongside any selection ring the user may have active. " +
      "Topic IDs must match the full path as seen in the visualiser " +
      "(e.g. 'home/kitchen/temp'). Unknown topics are silently skipped and " +
      "reported in the response.",
    inputSchema: {
      type: "object",
      properties: {
        nodeIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of full topic path strings to highlight. " +
            "Maximum 200 entries — excess entries are silently dropped.",
        },
        color: {
          type: "string",
          description:
            "CSS hex colour for the highlight ring, e.g. '#cc0000'. " +
            "Accepts #rgb and #rrggbb formats. Defaults to '#cc0000' (red).",
        },
      },
      required: ["nodeIds"],
    },
    execute: executeHighlightNodes,
    annotations: { readOnlyHint: false },
  },
  {
    name: "clearHighlights",
    description:
      "Remove all node highlight rings from the graph. " +
      "Has no effect if no highlights are currently active.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    execute: executeClearHighlights,
    annotations: { readOnlyHint: false },
  },
];

// ── Registration ─────────────────────────────────────────────────────────────

/**
 * Register all WebMCP tools with the browser.
 * No-op if:
 * - `navigator.modelContext` is not available (not Chrome 146+)
 * - `webmcpEnabled` is false in config.json
 * - Tools are already registered
 */
export function registerWebMcpTools(): void {
  const cfg = getConfig();
  if (cfg.webmcpEnabled === false) return;
  if (!navigator.modelContext) return;
  if (registered) return;

  try {
    for (const tool of TOOLS) {
      navigator.modelContext.registerTool(tool);
      registeredToolNames.push(tool.name);
    }
    registered = true;
    console.log(
      `[WebMCP] Registered ${TOOLS.length} tools with navigator.modelContext`,
    );
  } catch (err) {
    console.warn("[WebMCP] Failed to register tools:", err);
  }
}

/**
 * Unregister all WebMCP tools from the browser.
 * Safe to call even if tools were never registered.
 */
export function unregisterWebMcpTools(): void {
  if (!registered || !navigator.modelContext) return;

  try {
    for (const name of registeredToolNames) {
      navigator.modelContext.unregisterTool(name);
    }
  } catch (err) {
    console.warn("[WebMCP] Failed to unregister tools:", err);
  }

  registeredToolNames.length = 0;
  registered = false;
}
