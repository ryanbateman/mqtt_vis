import type { DetectorResult, EntityTagMetadata } from "../../types/payloadTags";
import type { DomainEntity, EntityDeclaration } from "../../types/entities";
import { ensureEntity, type EntityRegistry } from "./entityOps";

/**
 * Shelly (Gen1 announce-based) — hybrid provider.
 *
 * Gen1 devices publish retained JSON announces on `shellies/announce` and
 * `shellies/<id>/announce` ({id, model, mac, ip, fw_ver}) — parsed in the
 * analyzer worker into declarations (detectShelly). Their live topics
 * (`shellies/<id>/relay/0`, `/sensor/...`, `/online`) are bound
 * structurally on the main thread, which also covers announce-less devices
 * publishing under shellies/ (Plus-gen, missed retained announce) with a
 * provisional entity that a later announce enriches.
 */

const SHELLY_PREFIX = "shellies/";

/** True for the retained announce documents (global and per-device). */
export function isShellyAnnounceTopic(topic: string): boolean {
  if (!topic.startsWith(SHELLY_PREFIX) || !topic.endsWith("announce")) return false;
  const segments = topic.split("/").length;
  return segments === 2 || segments === 3;
}

/** Entity key for one shelly device topic id. */
function shellyKey(id: string): string {
  return `shelly:dev:${id}`;
}

/** Parse one announce JSON into a device declaration. Returns [] when unparseable. */
export function parseShellyAnnounce(topic: string, payload: string): EntityDeclaration[] {
  if (!isShellyAnnounceTopic(topic) || payload.length === 0) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return [];
  }
  if (typeof raw !== "object" || raw === null) return [];
  const cfg = raw as Record<string, unknown>;
  if (typeof cfg.id !== "string" || cfg.id.length === 0) return [];

  const attributes: Record<string, string> = {};
  for (const attr of ["model", "mac", "ip", "fw_ver"] as const) {
    if (typeof cfg[attr] === "string" && cfg[attr]) attributes[attr] = cfg[attr] as string;
  }

  return [
    {
      key: shellyKey(cfg.id),
      ecosystem: "shelly",
      role: "device",
      label: cfg.id,
      parentKey: null,
      attributes,
      // Live topics bind structurally (prefix-shaped, not enumerable here).
      memberTopics: [],
      availability: [],
      sourceTopic: topic,
    },
  ];
}

/**
 * Worker phase-1 detector: announce topics yield a shelly tag carrying the
 * parsed declaration (stripped into the entity registry by setPayloadTags).
 */
export function detectShelly(topic: string, payload: string): DetectorResult[] {
  const declarations = parseShellyAnnounce(topic, payload);
  if (declarations.length === 0) return [];

  const device = declarations[0];
  const metadata: EntityTagMetadata = {
    entityKey: device.key,
    role: device.role,
    label: device.label,
    online: null,
    declarations,
  };
  return [{ tag: "shelly", confidence: 1, fieldPath: "", metadata }];
}

/** Result of recording one shelly message: entity to tag + change flag. */
export interface ShellyHit {
  entity: DomainEntity;
  changed: boolean;
}

/**
 * Main-thread hook: a message arrived under shellies/. Binds the node to
 * its device (creating a provisional entity when no announce has been seen),
 * and flips online state on the per-device `online` LWT ("true"/"false").
 * The global `shellies/announce` topic has no device segment — skipped here;
 * the worker parses it. Returns null for non-shelly topics.
 */
export function recordShellyMessage(
  registry: EntityRegistry,
  topic: string,
  nodeId: string,
  payload: string,
): ShellyHit | null {
  if (!topic.startsWith(SHELLY_PREFIX)) return null;
  const segments = topic.split("/");
  const id = segments[1];
  if (!id || (segments.length === 2 && id === "announce")) return null;
  if (id === "command") return null; // broadcast command topic, not a device

  const result = ensureEntity(registry, {
    key: shellyKey(id),
    ecosystem: "shelly",
    role: "device",
    label: id,
    parentKey: null,
  });
  if (!result) return null;
  const device = result.entity;
  let changed = result.created;

  if (!device.topicNodeIds.has(nodeId)) {
    (device.topicNodeIds as Set<string>).add(nodeId);
    changed = true;
  }
  if (device.anchorTopicId === null) {
    device.anchorTopicId = nodeId;
    changed = true;
  }

  if (segments.length === 3 && segments[2] === "online") {
    const online =
      payload === "true" ? true : payload === "false" ? false : device.online;
    if (online !== device.online) {
      device.online = online;
      changed = true;
    }
  }

  return { entity: device, changed };
}
