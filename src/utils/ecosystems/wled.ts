import type { DomainEntity } from "../../types/entities";
import { ensureEntity, type EntityRegistry } from "./entityOps";

/**
 * WLED — ESP32/ESP8266 addressable-LED firmware, structural (tier-3) provider.
 *
 * WLED publishes state under its configurable device topic (default
 * `wled/<mac>`, but any prefix is possible — including a `wled` segment
 * mid-path, e.g. `open/wled/<name>`):
 *   <dev>/g          brightness, ASCII 0–255
 *   <dev>/c          colour, "#RRGGBB" / "#WWRRGGBB"
 *   <dev>/v          XML API state (<?xml …><vs>…</vs>)
 *   <dev>/status     retained LWT: "online" / "offline"
 *   <dev>/button/<n>, <dev>/motion/<n>   usermod on/off states
 * and subscribes for commands on <dev>, <dev>/col, <dev>/api (plus an
 * optional group topic with the same shape).
 *
 * Detection needs both a topic and a payload signal: a `wled` segment
 * anywhere in the device path plus a publish leaf whose payload matches
 * that leaf's shape — the short generic leaves (g/c/status) are far too
 * common to claim on topic shape alone. The `/v` XML state signature is
 * WLED-specific, so it claims under any prefix (the opendtu/homie
 * approach). Command topics (col/api/bare) never CREATE a device — a group
 * topic like `wled/all/api` must not become a phantom device — they only
 * bind to devices already known.
 */

const deviceKey = (deviceTopic: string) => `wled:dev:${deviceTopic}`;

/** Result of recording one WLED message: entity to tag + change flag. */
export interface WledHit {
  entity: DomainEntity;
  changed: boolean;
}

/** True for the WLED XML API state signature (root element <vs>). */
function isWledXmlState(payload: string): boolean {
  return payload.startsWith("<?xml") && payload.includes("<vs>");
}

/** Payload shape per publish leaf; wrong shape = not WLED, don't claim. */
function matchesPublishLeaf(leaf: string, payload: string): boolean {
  switch (leaf) {
    case "g": {
      if (!/^\d{1,3}$/.test(payload)) return false;
      return Number(payload) <= 255;
    }
    case "c":
      return /^#[0-9a-fA-F]{6,8}$/.test(payload);
    case "v":
      return isWledXmlState(payload);
    case "status":
      return payload === "online" || payload === "offline";
    default:
      return false;
  }
}

/**
 * Main-thread hook: a message that might be WLED. Derives the device from
 * the topic (everything before the publish leaf), binds the node, flips
 * online on the status LWT, and captures brightness/colour for display.
 * Returns null for non-WLED topics.
 */
export function recordWledMessage(
  registry: EntityRegistry,
  topic: string,
  nodeId: string,
  payload: string,
): WledHit | null {
  const segments = topic.split("/");
  const last = segments[segments.length - 1];
  const secondLast = segments.length >= 2 ? segments[segments.length - 2] : null;

  // Identify the publish leaf and the device topic it hangs off.
  let leaf: string | null = null;
  let deviceTopic: string | null = null;

  if (
    (secondLast === "button" || secondLast === "motion") &&
    /^\d+$/.test(last) && segments.length >= 3 &&
    (payload === "on" || payload === "off")
  ) {
    // Usermod status: <dev>/button/<n>, <dev>/motion/<n>.
    leaf = secondLast;
    deviceTopic = segments.slice(0, -2).join("/");
  } else if (segments.length >= 2 && matchesPublishLeaf(last, payload)) {
    leaf = last;
    deviceTopic = segments.slice(0, -1).join("/");
  }

  // Anchor requirement: a `wled` segment in the device path, except for the
  // WLED-specific XML state which claims at any prefix.
  if (leaf !== null && deviceTopic !== null && leaf !== "v" &&
      !deviceTopic.split("/").includes("wled")) {
    leaf = null;
    deviceTopic = null;
  }

  if (leaf === null || deviceTopic === null) {
    // Not publish evidence. Command/other topics group under a KNOWN device:
    // <dev>/col, <dev>/api, unknown leaves, or the bare device topic itself.
    const parent = segments.slice(0, -1).join("/");
    if (registry.entities.has(deviceKey(parent))) {
      deviceTopic = parent;
    } else if (registry.entities.has(deviceKey(topic))) {
      deviceTopic = topic;
    } else {
      return null;
    }
  }

  const result = ensureEntity(registry, {
    key: deviceKey(deviceTopic),
    ecosystem: "wled",
    role: "device",
    label: deviceTopic.split("/").pop() ?? deviceTopic,
    parentKey: null,
  });
  if (!result) return null;
  const dev = result.entity;
  let changed = result.created;

  if (!dev.topicNodeIds.has(nodeId)) {
    (dev.topicNodeIds as Set<string>).add(nodeId);
    changed = true;
  }

  // Anchor on the full XML state when we can; else first-seen.
  if (leaf === "v") {
    if (dev.anchorTopicId !== nodeId) {
      dev.anchorTopicId = nodeId;
      changed = true;
    }
  } else if (dev.anchorTopicId === null) {
    dev.anchorTopicId = nodeId;
    changed = true;
  }

  // Availability from the retained status LWT.
  if (leaf === "status") {
    const online = payload === "online";
    if (dev.online !== online) {
      dev.online = online;
      changed = true;
    }
  }

  // Display attributes from the retained state leaves.
  if (leaf === "g" && dev.attributes.brightness !== payload) {
    dev.attributes.brightness = payload;
    changed = true;
  }
  if (leaf === "c") {
    const color = payload.toLowerCase();
    if (dev.attributes.color !== color) {
      dev.attributes.color = color;
      changed = true;
    }
  }

  return { entity: dev, changed };
}
