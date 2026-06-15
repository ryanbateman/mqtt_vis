import type { DomainEntity, EntityDeclaration } from "../../types/entities";
import { applyEntityDeclarations, type EntityRegistry } from "./entityOps";

/**
 * Homie (convention 3.x / 4.x) — declaration provider with an accumulator.
 *
 * Homie devices describe themselves through many retained `$`-attribute
 * topics rather than one document: `<base>/<device>/$homie` (version),
 * `$name`, `$state` (ready/init/disconnected/lost/sleeping/alert), `$nodes`
 * (csv); per-node `$name`/`$properties` (csv); per-property `$datatype`/...;
 * and the retained value topics at `<base>/<device>/<node>/<property>`. The
 * base topic is arbitrary (Valetudo robots speak Homie at `valetudo/<id>/`),
 * so detection is signature-based on `$homie` at any base.
 *
 * Because the attributes arrive across many messages (in any order during the
 * retained burst), this keeps a per-device accumulator and re-derives the
 * device → node entity declarations as attributes land. Attributes seen
 * before their device's anchor (`$homie`/`$state`/`$nodes`) are buffered and
 * drained once the device path is known. Property value topics bind and tag
 * through the shared `recordEntityTopicHit` path once declared. Homie 5
 * (single `$description` JSON) is out of scope here.
 */

interface HomieNode {
  name?: string;
  properties: string[];
}

interface HomieDevice {
  version?: string;
  name?: string;
  nodes: Map<string, HomieNode>;
}

/** Accumulated Homie state across messages. Reset on (re)connect. */
export interface HomieState {
  /** Known device path ("<base>/<device>") -> accumulated structure. */
  devices: Map<string, HomieDevice>;
  /** Attributes seen before their device anchor; drained once it's known. */
  pending: { topic: string; payload: string }[];
}

export function createHomieState(): HomieState {
  return { devices: new Map(), pending: [] };
}

/** True for any Homie attribute topic (final segment starts with `$`). */
export function isHomieAttributeTopic(topic: string): boolean {
  const segments = topic.split("/");
  return segments[segments.length - 1]?.startsWith("$") ?? false;
}

const homieDeviceKey = (devicePath: string) => `homie:dev:${devicePath}`;
const homieNodeKey = (devicePath: string, node: string) => `homie:node:${devicePath}/${node}`;

/** Map a Homie `$state` enum to online; null = unknown (leave unchanged). */
function stateToOnline(payload: string): boolean | null | undefined {
  switch (payload) {
    case "ready":
      return true;
    case "disconnected":
    case "lost":
    case "sleeping":
    case "alert":
      return false;
    case "init":
      return null; // connecting — no definite online state yet
    default:
      return undefined; // non-conformant (e.g. JSON blob) — don't touch online
  }
}

/** Split a Homie attribute topic into its object path and `$attr` name. */
function splitAttribute(topic: string): { objectPath: string; attr: string } | null {
  const segments = topic.split("/");
  const dollarIdx = segments.findIndex((s) => s.startsWith("$"));
  if (dollarIdx <= 0) return null; // need at least one path segment before it
  return { objectPath: segments.slice(0, dollarIdx).join("/"), attr: segments[dollarIdx] };
}

/** The longest known device path that is a prefix of `objectPath`. */
function findDevicePath(state: HomieState, objectPath: string): string | null {
  let best: string | null = null;
  for (const dp of state.devices.keys()) {
    if ((objectPath === dp || objectPath.startsWith(dp + "/")) && (!best || dp.length > best.length)) {
      best = dp;
    }
  }
  return best;
}

const DEVICE_ANCHOR_ATTRS = new Set(["$homie", "$state", "$nodes"]);

/**
 * Fold one attribute into the accumulator. Returns the affected device path,
 * or null when it can't be placed yet (caller buffers it).
 */
function ingest(state: HomieState, objectPath: string, attr: string, payload: string): string | null {
  // Device-anchor attributes name the device path directly.
  if (DEVICE_ANCHOR_ATTRS.has(attr)) {
    const dp = objectPath;
    const dev: HomieDevice = state.devices.get(dp) ?? { nodes: new Map() };
    if (attr === "$homie") dev.version = payload;
    if (attr === "$nodes") {
      for (const id of payload.split(",").map((s) => s.trim()).filter(Boolean)) {
        if (!dev.nodes.has(id)) dev.nodes.set(id, { properties: [] });
      }
    }
    state.devices.set(dp, dev);
    return dp;
  }

  // Otherwise the attribute hangs off an already-known device path.
  const dp = findDevicePath(state, objectPath);
  if (!dp) return null;
  const dev = state.devices.get(dp)!;
  const rest = objectPath === dp ? [] : objectPath.slice(dp.length + 1).split("/");

  if (rest.length === 0) {
    if (attr === "$name") dev.name = payload;
  } else {
    const nodeId = rest[0];
    const node: HomieNode = dev.nodes.get(nodeId) ?? { properties: [] };
    if (rest.length === 1) {
      if (attr === "$name") node.name = payload;
      if (attr === "$properties") {
        node.properties = payload.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
    // Property-level attrs ($datatype/$unit/...) need no model changes in v1.
    dev.nodes.set(nodeId, node);
  }
  return dp;
}

/** Re-derive and apply this device's declarations. Returns whether anything changed. */
function syncDevice(registry: EntityRegistry, state: HomieState, devicePath: string): boolean {
  const dev = state.devices.get(devicePath);
  if (!dev) return false;
  const deviceKey = homieDeviceKey(devicePath);
  const deviceId = devicePath.split("/").pop() ?? devicePath;
  const sourceTopic = `${devicePath}/$homie`;

  const decls: EntityDeclaration[] = [
    {
      key: deviceKey,
      ecosystem: "homie",
      role: "device",
      label: dev.name || deviceId,
      parentKey: null,
      attributes: dev.version ? { version: dev.version } : {},
      memberTopics: [],
      availability: [],
      sourceTopic,
    },
  ];
  for (const [nodeId, node] of dev.nodes) {
    decls.push({
      key: homieNodeKey(devicePath, nodeId),
      ecosystem: "homie",
      role: "node",
      label: node.name || nodeId,
      parentKey: deviceKey,
      attributes: {},
      memberTopics: node.properties.map((p) => `${devicePath}/${nodeId}/${p}`),
      availability: [],
      sourceTopic,
    });
  }
  return applyEntityDeclarations(registry, decls);
}

/** Result of recording one Homie message: entity to tag + change flag. */
export interface HomieHit {
  entity: DomainEntity;
  changed: boolean;
}

/**
 * Main-thread hook: a Homie `$`-attribute arrived. Folds it into the
 * accumulator, re-derives the device → node declarations, drives the device
 * online state from `$state`, and groups the attribute topic under the
 * device. Value topics return null (they bind via recordEntityTopicHit once
 * declared). Returns null for non-Homie / non-attribute topics.
 */
export function recordHomieMessage(
  registry: EntityRegistry,
  state: HomieState,
  topic: string,
  nodeId: string,
  payload: string,
): HomieHit | null {
  const split = splitAttribute(topic);
  if (!split) return null;

  const dp = ingest(state, split.objectPath, split.attr, payload);
  if (!dp) {
    // Device anchor not seen yet — buffer and wait.
    state.pending.push({ topic, payload });
    return null;
  }

  let changed = syncDevice(registry, state, dp);

  // Registering a device path may unblock buffered attributes.
  if (DEVICE_ANCHOR_ATTRS.has(split.attr) && state.pending.length > 0) {
    const stillPending: { topic: string; payload: string }[] = [];
    const touched = new Set<string>();
    for (const item of state.pending) {
      const s = splitAttribute(item.topic);
      const placed = s ? ingest(state, s.objectPath, s.attr, item.payload) : null;
      if (placed) touched.add(placed);
      else stillPending.push(item);
    }
    state.pending = stillPending;
    for (const path of touched) changed = syncDevice(registry, state, path) || changed;
  }

  const device = registry.entities.get(homieDeviceKey(dp));
  if (!device) return null;

  // `$state` drives the device online dot (multiple offline enums, so handled
  // here rather than via the binary availability mechanism).
  if (split.attr === "$state") {
    const online = stateToOnline(payload);
    if (online !== undefined && online !== device.online) {
      device.online = online;
      changed = true;
    }
  }

  // Group the attribute topic under the device; anchor on `$state` if we can.
  if (!device.topicNodeIds.has(nodeId)) {
    (device.topicNodeIds as Set<string>).add(nodeId);
    changed = true;
  }
  if (split.attr === "$state" && device.anchorTopicId !== nodeId) {
    device.anchorTopicId = nodeId;
    changed = true;
  } else if (device.anchorTopicId === null) {
    device.anchorTopicId = nodeId;
    changed = true;
  }

  return { entity: device, changed };
}
