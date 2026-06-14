import type { DomainEntity } from "../../types/entities";
import { ensureEntity, type EntityRegistry } from "./entityOps";

/**
 * OwnTracks — structural provider.
 *
 * OwnTracks phones/devices publish to `owntracks/<user>/<device>`; the topic
 * shape plus the JSON `_type` field IS the signal (no retained defining
 * document). The base topic carries location reports (`_type:"location"`,
 * with lat/lon/tst/tid) and the last-will (`_type:"lwt"`); subtopics carry
 * transition events (`.../event`, `_type:"transition"`), the friendly card
 * (`.../info`, `_type:"card"` with a `name`), waypoints, and commands.
 *
 * Entities are derived on the main thread per message: one `user` entity
 * parenting one `tracker` entity per device, with every device topic grouped
 * under it. Lifecycle (online/offline) flips on the location/lwt `_type`;
 * the card `name` and `tid` refine the label. The location payload also
 * carries lat/lon, so the existing geo detector lights up the map and trail
 * independently — this provider only adds the identity layer.
 */

const OWNTRACKS_PREFIX = "owntracks/";

/** Entity key for one OwnTracks user (groups that user's devices). */
function userKey(user: string): string {
  return `owntracks:user:${user}`;
}

/** Entity key for one OwnTracks device (scoped by user, since device ids repeat). */
function deviceKey(user: string, device: string): string {
  return `owntracks:dev:${user}/${device}`;
}

/** Result of recording one OwnTracks message: entity to tag + change flag. */
export interface OwnTracksHit {
  entity: DomainEntity;
  changed: boolean;
}

/**
 * Main-thread hook: a message arrived under owntracks/. Derives the user and
 * device entities from `owntracks/<user>/<device>[/...]`, binds the node,
 * flips online on the location/lwt `_type`, and refines the device label
 * from the card `name`/`tid`. Returns null for non-OwnTracks topics.
 */
export function recordOwnTracksMessage(
  registry: EntityRegistry,
  topic: string,
  nodeId: string,
  payload: string,
): OwnTracksHit | null {
  if (!topic.startsWith(OWNTRACKS_PREFIX)) return null;
  const segments = topic.split("/");
  const user = segments[1];
  const device = segments[2];
  // Need at least owntracks/<user>/<device> to identify a device.
  if (!user || !device) return null;

  // Best-effort parse; non-JSON or encrypted payloads still bind structurally.
  let msg: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed && typeof parsed === "object") msg = parsed as Record<string, unknown>;
  } catch {
    // leave msg null
  }
  const type = typeof msg?._type === "string" ? msg._type : null;

  // User entity — a pure grouping parent (no topics of its own).
  const userResult = ensureEntity(registry, {
    key: userKey(user),
    ecosystem: "owntracks",
    role: "user",
    label: user,
    parentKey: null,
  });
  if (!userResult) return null;
  let changed = userResult.created;

  // Device entity — the topic's owner and the click-to-select target.
  const deviceResult = ensureEntity(registry, {
    key: deviceKey(user, device),
    ecosystem: "owntracks",
    role: "tracker",
    label: device,
    parentKey: userKey(user),
    attributes: { type: "tracker" },
  });
  if (!deviceResult) return { entity: userResult.entity, changed };
  const dev = deviceResult.entity;
  if (deviceResult.created) changed = true;

  if (!dev.topicNodeIds.has(nodeId)) {
    (dev.topicNodeIds as Set<string>).add(nodeId);
    changed = true;
  }

  // Anchor at the base location topic when we can; otherwise first-seen.
  const isBase = segments.length === 3;
  if (isBase && type === "location") {
    if (dev.anchorTopicId !== nodeId) {
      dev.anchorTopicId = nodeId;
      changed = true;
    }
  } else if (dev.anchorTopicId === null) {
    dev.anchorTopicId = nodeId;
    changed = true;
  }

  // Lifecycle: a location report means alive; the LWT means it dropped.
  if (type === "location" && dev.online !== true) {
    dev.online = true;
    changed = true;
  } else if (type === "lwt" && dev.online !== false) {
    dev.online = false;
    changed = true;
  }

  // The card carries a human name; prefer it over the raw device segment.
  if (type === "card" && typeof msg?.name === "string" && msg.name && dev.label !== msg.name) {
    dev.label = msg.name;
    changed = true;
  }

  // tid (2-char tracker id) is a useful attribute even when no card arrives.
  if (typeof msg?.tid === "string" && msg.tid && dev.attributes.tid !== msg.tid) {
    dev.attributes.tid = msg.tid;
    changed = true;
  }

  // Transition events (enter/leave a named region) — surface the latest.
  if (type === "transition") {
    const event = typeof msg?.event === "string" ? msg.event : null;
    const desc = typeof msg?.desc === "string" ? msg.desc : null;
    const summary = [event, desc].filter(Boolean).join(" ");
    if (summary && dev.attributes.lastEvent !== summary) {
      dev.attributes.lastEvent = summary;
      changed = true;
    }
  }

  return { entity: dev, changed };
}
