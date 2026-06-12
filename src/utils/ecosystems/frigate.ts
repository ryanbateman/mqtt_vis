import type { DomainEntity } from "../../types/entities";
import { ensureEntity, type EntityRegistry } from "./entityOps";

/**
 * Frigate NVR — structural provider.
 *
 * Frigate publishes no defining document over MQTT; its topic shape IS the
 * signal: `frigate/available` (LWT online/offline), `frigate/events`,
 * `frigate/stats`, and per-camera trees `frigate/<camera>/...` (state
 * toggles, motion, and JPEG snapshots on `frigate/<camera>/<object>/
 * snapshot` — which the existing image detector previews). Entities are
 * derived on the main thread per message: one NVR entity parenting one
 * entity per camera. Default topic prefix only (`frigate/`).
 */

const FRIGATE_PREFIX = "frigate/";
const NVR_KEY = "frigate:nvr";

/**
 * First-level segments under frigate/ that are NVR-level topics, not camera
 * names (from the Frigate MQTT docs).
 */
const RESERVED_SEGMENTS = new Set([
  "available",
  "events",
  "reviews",
  "stats",
  "notifications",
  "restart",
  "onConnect",
  "camera_activity",
]);

/** Result of recording one frigate message: entity to tag + change flag. */
export interface FrigateHit {
  entity: DomainEntity;
  changed: boolean;
}

/** Get or create the NVR entity that parents all cameras. */
function ensureNvr(registry: EntityRegistry): DomainEntity | null {
  const result = ensureEntity(registry, {
    key: NVR_KEY,
    ecosystem: "frigate",
    role: "nvr",
    label: "Frigate",
    parentKey: null,
  });
  return result?.entity ?? null;
}

/**
 * Main-thread hook: a message arrived under frigate/. Derives the NVR and
 * camera entities from the topic shape, binds the node, and tracks NVR
 * availability. Returns null for non-frigate topics.
 */
export function recordFrigateMessage(
  registry: EntityRegistry,
  topic: string,
  nodeId: string,
  payload: string,
): FrigateHit | null {
  if (!topic.startsWith(FRIGATE_PREFIX)) return null;
  const segments = topic.split("/");
  const first = segments[1];
  if (!first) return null;

  const nvr = ensureNvr(registry);
  if (!nvr) return null;
  let changed = false;

  // NVR-level topics bind to the NVR entity; `available` carries its LWT.
  if (RESERVED_SEGMENTS.has(first)) {
    if (!nvr.topicNodeIds.has(nodeId)) {
      (nvr.topicNodeIds as Set<string>).add(nodeId);
      changed = true;
    }
    if (topic === "frigate/available") {
      if (nvr.anchorTopicId !== nodeId) {
        nvr.anchorTopicId = nodeId;
        changed = true;
      }
      const online =
        payload === "online" ? true : payload === "offline" ? false : nvr.online;
      if (online !== nvr.online) {
        nvr.online = online;
        changed = true;
      }
    } else if (nvr.anchorTopicId === null) {
      nvr.anchorTopicId = nodeId;
      changed = true;
    }
    return { entity: nvr, changed };
  }

  // Everything else is a camera tree: frigate/<camera>/...
  const result = ensureEntity(registry, {
    key: `frigate:cam:${first}`,
    ecosystem: "frigate",
    role: "camera",
    label: first,
    parentKey: NVR_KEY,
  });
  if (!result) return { entity: nvr, changed };
  const camera = result.entity;
  if (result.created) changed = true;

  if (!camera.topicNodeIds.has(nodeId)) {
    (camera.topicNodeIds as Set<string>).add(nodeId);
    changed = true;
  }
  if (camera.anchorTopicId === null) {
    camera.anchorTopicId = nodeId;
    changed = true;
  }

  return { entity: camera, changed };
}
