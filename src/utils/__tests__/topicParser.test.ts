import { describe, it, expect } from "vitest";
import {
  parseTopicSegments,
  createTopicNode,
  ensureTopicPath,
  ensureTopicPathTracked,
  flattenTree,
  collectAllNodes,
  countNodes,
  getFixedPrefix,
  findNode,
  getAncestorPaths,
} from "../topicParser";

describe("parseTopicSegments", () => {
  it("should split a multi-segment topic", () => {
    expect(parseTopicSegments("home/kitchen/temp")).toEqual(["home", "kitchen", "temp"]);
  });

  it("should return a single-element array for a single segment", () => {
    expect(parseTopicSegments("devices")).toEqual(["devices"]);
  });

  it("should return an empty array for an empty string", () => {
    expect(parseTopicSegments("")).toEqual([]);
  });

  it("should filter out empty segments from leading slashes", () => {
    expect(parseTopicSegments("/a/b")).toEqual(["a", "b"]);
  });

  it("should filter out empty segments from trailing slashes", () => {
    expect(parseTopicSegments("a/b/")).toEqual(["a", "b"]);
  });

  it("should filter out empty segments from double slashes", () => {
    expect(parseTopicSegments("a//b")).toEqual(["a", "b"]);
  });
});

describe("createTopicNode", () => {
  it("should create a node with correct id and segment", () => {
    const node = createTopicNode("home/kitchen", "kitchen");
    expect(node.id).toBe("home/kitchen");
    expect(node.segment).toBe("kitchen");
  });

  it("should initialize all fields to defaults", () => {
    const node = createTopicNode("test", "test");
    expect(node.children.size).toBe(0);
    expect(node.messageCount).toBe(0);
    expect(node.messageRate).toBe(0);
    expect(node.aggregateRate).toBe(0);
    expect(node.lastPayload).toBeNull();
    expect(node.lastTimestamp).toBe(0);
    expect(node.lastQoS).toBe(0);
    expect(node.pulseRate).toBe(0);
  });

  it("should create a root node with empty strings", () => {
    const node = createTopicNode("", "");
    expect(node.id).toBe("");
    expect(node.segment).toBe("");
  });
});

describe("ensureTopicPath", () => {
  it("should create intermediate nodes for a deep topic", () => {
    const root = createTopicNode("", "");
    const leaf = ensureTopicPath(root, "a/b/c");

    expect(leaf.id).toBe("a/b/c");
    expect(leaf.segment).toBe("c");

    // Intermediate nodes should exist
    const a = root.children.get("a");
    expect(a).toBeDefined();
    expect(a!.id).toBe("a");

    const b = a!.children.get("b");
    expect(b).toBeDefined();
    expect(b!.id).toBe("a/b");

    const c = b!.children.get("c");
    expect(c).toBeDefined();
    expect(c).toBe(leaf);
  });

  it("should return existing leaf on repeat call", () => {
    const root = createTopicNode("", "");
    const first = ensureTopicPath(root, "a/b");
    const second = ensureTopicPath(root, "a/b");
    expect(first).toBe(second);
  });

  it("should handle single-segment topics", () => {
    const root = createTopicNode("", "");
    const leaf = ensureTopicPath(root, "devices");
    expect(leaf.id).toBe("devices");
    expect(root.children.get("devices")).toBe(leaf);
  });

  it("should share intermediate nodes for overlapping paths", () => {
    const root = createTopicNode("", "");
    ensureTopicPath(root, "a/b/c");
    ensureTopicPath(root, "a/b/d");

    const a = root.children.get("a")!;
    const b = a.children.get("b")!;
    expect(b.children.size).toBe(2);
    expect(b.children.has("c")).toBe(true);
    expect(b.children.has("d")).toBe(true);
  });
});

describe("ensureTopicPathTracked", () => {
  it("should return correct newNodes count for a fresh topic", () => {
    const root = createTopicNode("", "");
    const { node, newNodes } = ensureTopicPathTracked(root, "a/b/c");
    expect(node.id).toBe("a/b/c");
    expect(newNodes).toBe(3);
  });

  it("should return 0 newNodes for an existing topic", () => {
    const root = createTopicNode("", "");
    ensureTopicPathTracked(root, "a/b/c");
    const { newNodes } = ensureTopicPathTracked(root, "a/b/c");
    expect(newNodes).toBe(0);
  });

  it("should count only genuinely new segments", () => {
    const root = createTopicNode("", "");
    ensureTopicPathTracked(root, "a/b/c"); // 3 new
    const { newNodes } = ensureTopicPathTracked(root, "a/b/d"); // only "d" is new
    expect(newNodes).toBe(1);
  });

  it("should return the same node as ensureTopicPath", () => {
    const root = createTopicNode("", "");
    const { node } = ensureTopicPathTracked(root, "x/y");
    const direct = findNode(root, ["x", "y"]);
    expect(node).toBe(direct);
  });
});

describe("flattenTree", () => {
  it("should return only root for an empty tree", () => {
    const root = createTopicNode("", "");
    const flat = flattenTree(root);
    expect(flat).toHaveLength(1);
    expect(flat[0]).toEqual({
      nodeId: "",
      label: "(root)",
      depth: 0,
      parentId: null,
    });
  });

  it("should assign correct depth and parentId", () => {
    const root = createTopicNode("", "");
    ensureTopicPath(root, "a/b/c");
    const flat = flattenTree(root);

    const nodeMap = new Map(flat.map((n) => [n.nodeId, n]));

    expect(nodeMap.get("")!.depth).toBe(0);
    expect(nodeMap.get("")!.parentId).toBeNull();

    expect(nodeMap.get("a")!.depth).toBe(1);
    expect(nodeMap.get("a")!.parentId).toBe("");

    expect(nodeMap.get("a/b")!.depth).toBe(2);
    expect(nodeMap.get("a/b")!.parentId).toBe("a");

    expect(nodeMap.get("a/b/c")!.depth).toBe(3);
    expect(nodeMap.get("a/b/c")!.parentId).toBe("a/b");
  });

  it("should use segment name as label, except root", () => {
    const root = createTopicNode("", "");
    ensureTopicPath(root, "sensors/temp");
    const flat = flattenTree(root);
    const nodeMap = new Map(flat.map((n) => [n.nodeId, n]));

    expect(nodeMap.get("")!.label).toBe("(root)");
    expect(nodeMap.get("sensors")!.label).toBe("sensors");
    expect(nodeMap.get("sensors/temp")!.label).toBe("temp");
  });

  it("should include all nodes in a branching tree", () => {
    const root = createTopicNode("", "");
    ensureTopicPath(root, "a/b");
    ensureTopicPath(root, "a/c");
    ensureTopicPath(root, "d");
    const flat = flattenTree(root);

    // root + a + a/b + a/c + d = 5
    expect(flat).toHaveLength(5);
  });
});

describe("collectAllNodes", () => {
  it("should return only root for an empty tree", () => {
    const root = createTopicNode("", "");
    const nodes = collectAllNodes(root);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toBe(root);
  });

  it("should return all nodes in the tree", () => {
    const root = createTopicNode("", "");
    ensureTopicPath(root, "a/b/c");
    ensureTopicPath(root, "a/d");
    const nodes = collectAllNodes(root);
    // root + a + a/b + a/b/c + a/d = 5
    expect(nodes).toHaveLength(5);
  });

  it("should include the root node", () => {
    const root = createTopicNode("", "");
    ensureTopicPath(root, "x");
    const nodes = collectAllNodes(root);
    expect(nodes).toContain(root);
  });
});

describe("countNodes", () => {
  it("should return 1 for root-only tree", () => {
    const root = createTopicNode("", "");
    expect(countNodes(root)).toBe(1);
  });

  it("should count all nodes in a linear path", () => {
    const root = createTopicNode("", "");
    ensureTopicPath(root, "a/b/c");
    // root + a + a/b + a/b/c = 4
    expect(countNodes(root)).toBe(4);
  });

  it("should count all nodes in a branching tree", () => {
    const root = createTopicNode("", "");
    ensureTopicPath(root, "a/b");
    ensureTopicPath(root, "a/c");
    ensureTopicPath(root, "d");
    // root + a + a/b + a/c + d = 5
    expect(countNodes(root)).toBe(5);
  });

  it("should match collectAllNodes length", () => {
    const root = createTopicNode("", "");
    ensureTopicPath(root, "x/y/z");
    ensureTopicPath(root, "x/w");
    expect(countNodes(root)).toBe(collectAllNodes(root).length);
  });
});

describe("getFixedPrefix", () => {
  it("should extract fixed segments before #", () => {
    expect(getFixedPrefix("test/robot/huge/#")).toEqual(["test", "robot", "huge"]);
  });

  it("should stop at +", () => {
    expect(getFixedPrefix("test/+/data")).toEqual(["test"]);
  });

  it("should return empty array for bare #", () => {
    expect(getFixedPrefix("#")).toEqual([]);
  });

  it("should return all segments if no wildcards", () => {
    expect(getFixedPrefix("a/b/c")).toEqual(["a", "b", "c"]);
  });

  it("should return empty array for +", () => {
    expect(getFixedPrefix("+")).toEqual([]);
  });

  it("should handle + in the middle", () => {
    expect(getFixedPrefix("sensors/+/temp/#")).toEqual(["sensors"]);
  });
});

describe("findNode", () => {
  it("should return root for empty segments array", () => {
    const root = createTopicNode("", "");
    expect(findNode(root, [])).toBe(root);
  });

  it("should find an existing node", () => {
    const root = createTopicNode("", "");
    ensureTopicPath(root, "a/b/c");
    const found = findNode(root, ["a", "b", "c"]);
    expect(found).toBeDefined();
    expect(found!.id).toBe("a/b/c");
  });

  it("should find an intermediate node", () => {
    const root = createTopicNode("", "");
    ensureTopicPath(root, "a/b/c");
    const found = findNode(root, ["a", "b"]);
    expect(found).toBeDefined();
    expect(found!.id).toBe("a/b");
  });

  it("should return undefined for a missing path", () => {
    const root = createTopicNode("", "");
    ensureTopicPath(root, "a/b");
    expect(findNode(root, ["a", "x"])).toBeUndefined();
  });

  it("should return undefined for a path beyond existing depth", () => {
    const root = createTopicNode("", "");
    ensureTopicPath(root, "a/b");
    expect(findNode(root, ["a", "b", "c"])).toBeUndefined();
  });
});

describe("getAncestorPaths", () => {
  it("should return ancestors from parent to root for a deep topic", () => {
    expect(getAncestorPaths("home/kitchen/temp")).toEqual([
      "home/kitchen",
      "home",
      "",
    ]);
  });

  it("should return only root for a single-segment topic", () => {
    expect(getAncestorPaths("devices")).toEqual([""]);
  });

  it("should return correct ancestors for a two-segment topic", () => {
    expect(getAncestorPaths("a/b")).toEqual(["a", ""]);
  });

  it("should return correct ancestors for a deeply nested topic", () => {
    const paths = getAncestorPaths("a/b/c/d/e");
    expect(paths).toEqual(["a/b/c/d", "a/b/c", "a/b", "a", ""]);
  });
});
