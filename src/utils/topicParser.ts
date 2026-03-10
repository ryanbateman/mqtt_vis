import type { TopicNode } from "../types";
import type { GeoMetadata, GeoNode } from "../types/payloadTags";

/** Split an MQTT topic string into its segments. */
export function parseTopicSegments(topic: string): string[] {
  return topic.split("/").filter((s) => s.length > 0);
}

/** Create a new empty TopicNode. */
export function createTopicNode(id: string, segment: string): TopicNode {
  return {
    id,
    segment,
    children: new Map(),
    messageCount: 0,
    messageRate: 0,
    aggregateRate: 0,
    lastPayload: null,
    lastTimestamp: 0,
    lastQoS: 0,
    pulseRate: 0,
    lastPayloadSize: 0,
    largestPayloadSize: 0,
    lastUserProperties: null,
    payloadTags: null,
    tagsAnalyzed: false,
  };
}

/**
 * Ensure a topic path exists in the tree, creating intermediate nodes as needed.
 * Returns the leaf node for the given topic.
 */
export function ensureTopicPath(root: TopicNode, topic: string): TopicNode {
  const segments = parseTopicSegments(topic);
  let current = root;
  let pathSoFar = "";

  for (const segment of segments) {
    pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment;

    let child = current.children.get(segment);
    if (!child) {
      child = createTopicNode(pathSoFar, segment);
      current.children.set(segment, child);
    }
    current = child;
  }

  return current;
}

/**
 * Ensure a topic path exists in the tree, creating intermediate nodes as needed.
 * Returns the leaf node and the number of newly created nodes.
 * Use this instead of ensureTopicPath + countNodes for O(depth) instead of O(tree).
 */
export function ensureTopicPathTracked(
  root: TopicNode,
  topic: string
): { node: TopicNode; newNodes: number } {
  const segments = parseTopicSegments(topic);
  let current = root;
  let pathSoFar = "";
  let newNodes = 0;

  for (const segment of segments) {
    pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment;

    let child = current.children.get(segment);
    if (!child) {
      child = createTopicNode(pathSoFar, segment);
      current.children.set(segment, child);
      newNodes++;
    }
    current = child;
  }

  return { node: current, newNodes };
}

/**
 * Flatten a topic tree into arrays of GraphNode-compatible objects and links.
 * Walks the tree depth-first.
 */
export function flattenTree(
  root: TopicNode
): { nodeId: string; label: string; depth: number; parentId: string | null }[] {
  const result: {
    nodeId: string;
    label: string;
    depth: number;
    parentId: string | null;
  }[] = [];

  function walk(node: TopicNode, depth: number, parentId: string | null) {
    result.push({
      nodeId: node.id,
      label: node.segment || "(root)",
      depth,
      parentId,
    });
    for (const child of node.children.values()) {
      walk(child, depth + 1, node.id);
    }
  }

  walk(root, 0, null);
  return result;
}

/**
 * Collect all nodes in the tree into a flat array.
 */
export function collectAllNodes(root: TopicNode): TopicNode[] {
  const result: TopicNode[] = [];

  function walk(node: TopicNode) {
    result.push(node);
    for (const child of node.children.values()) {
      walk(child);
    }
  }

  walk(root);
  return result;
}

/**
 * Collect all nodes in the tree that have a geo payload tag.
 * Returns an array of { topicPath, geo } sorted by topic path for stable ordering.
 * Uses collectAllNodes() internally — O(n) over the tree.
 */
export function collectGeoNodes(root: TopicNode): GeoNode[] {
  const results: GeoNode[] = [];
  for (const node of collectAllNodes(root)) {
    const tag = node.payloadTags?.find((t) => t.tag === "geo");
    if (tag) {
      results.push({
        topicPath: node.id,
        geo: tag.metadata as GeoMetadata,
      });
    }
  }
  results.sort((a, b) => a.topicPath.localeCompare(b.topicPath));
  return results;
}

/**
 * Count total nodes in the tree (including root).
 */
export function countNodes(root: TopicNode): number {
  let count = 1;
  for (const child of root.children.values()) {
    count += countNodes(child);
  }
  return count;
}

/**
 * Extract the fixed (non-wildcard) prefix segments from a topic filter.
 * Stops at the first segment that is '#' or '+'.
 * E.g. "test/robot/huge/#" → ["test", "robot", "huge"]
 *      "test/+/data"       → ["test"]
 *      "#"                 → []
 */
export function getFixedPrefix(topicFilter: string): string[] {
  const segments = parseTopicSegments(topicFilter);
  const prefix: string[] = [];
  for (const seg of segments) {
    if (seg === "#" || seg === "+") break;
    prefix.push(seg);
  }
  return prefix;
}

/**
 * Walk the tree from root to find the node at the given path segments.
 * Returns undefined if the path doesn't exist in the tree.
 */
export function findNode(root: TopicNode, segments: string[]): TopicNode | undefined {
  let current: TopicNode | undefined = root;
  for (const seg of segments) {
    current = current.children.get(seg);
    if (!current) return undefined;
  }
  return current;
}

/**
 * Get all ancestor topic paths for a given topic, from immediate parent to root.
 * E.g. "home/kitchen/temp" → ["home/kitchen", "home", ""]
 * The root path "" is always included as the last element.
 */
export function getAncestorPaths(topic: string): string[] {
  const segments = parseTopicSegments(topic);
  const paths: string[] = [];

  // Walk backwards, dropping one segment at a time
  for (let i = segments.length - 1; i >= 1; i--) {
    paths.push(segments.slice(0, i).join("/"));
  }

  // Always include root
  paths.push("");

  return paths;
}
