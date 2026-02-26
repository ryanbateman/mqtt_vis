import type { TopicNode } from "../types";

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
 * Count total nodes in the tree (including root).
 */
export function countNodes(root: TopicNode): number {
  let count = 1;
  for (const child of root.children.values()) {
    count += countNodes(child);
  }
  return count;
}
