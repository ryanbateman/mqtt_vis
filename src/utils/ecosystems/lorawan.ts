import type { DomainEntity, EcosystemId } from "../../types/entities";
import { ensureEntity, type EntityRegistry } from "./entityOps";

/**
 * LoRaWAN — The Things Network (v3) and ChirpStack, structural providers.
 *
 * Both network servers publish self-describing uplinks (no defining
 * document), so entities are derived on the main thread per message,
 * mirroring OwnTracks/Frigate. Each network is its own ecosystem identity
 * (separate ring/preset/panel section) but shares this parser.
 *
 *  - TTN:        `v3/<app>@<tenant>/devices/<device>/<event>` — identity in
 *                the `end_device_ids` block of the JSON.
 *  - ChirpStack: `application/<id>/device/...` — identity in the payload
 *                (`applicationID`/`devEUI` on v3, a `deviceInfo` block on v4).
 *                The topic word "application" is generic, so a topic only
 *                counts when the payload actually looks like ChirpStack.
 *
 * Gateway GPS (TTN `rx_metadata[].location`, ChirpStack `rxInfo[].location`)
 * and any device-decoded lat/lon are picked up by the existing geo detector,
 * so the map/ring light up with no extra code here.
 */

/** Normalised identity extracted from one uplink, network-agnostic. */
interface LorawanIdentity {
  ecoId: EcosystemId; // "ttn" | "chirpstack"
  appId: string;
  appLabel: string | null;
  devKey: string; // device id (TTN) or dev EUI (ChirpStack)
  devLabel: string | null;
  devEui: string | null;
  /** An uplink or join — the device was heard, so it is alive. */
  heard: boolean;
}

/** Result of recording one LoRaWAN message: entity to tag + change flag. */
export interface LorawanHit {
  entity: DomainEntity;
  changed: boolean;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Parse a JSON payload into an object, or null when it isn't one. */
function parseObject(payload: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** TTN: `v3/<app>@<tenant>/devices/<device>/<event>`. */
function parseTtn(segments: string[], payload: string): LorawanIdentity | null {
  if (segments[0] !== "v3" || segments[2] !== "devices") return null;

  const msg = parseObject(payload);
  const ids = (msg?.end_device_ids ?? null) as Record<string, unknown> | null;
  const appIds = (ids?.application_ids ?? null) as Record<string, unknown> | null;

  // Topic fallbacks: the app segment is "<app>@<tenant>"; device is segment 3.
  const appId = asString(appIds?.application_id) ?? segments[1]?.split("@")[0] ?? null;
  const devKey = asString(ids?.device_id) ?? segments[3] ?? null;
  if (!appId || !devKey) return null;

  const event = segments[4] ?? null;
  return {
    ecoId: "ttn",
    appId,
    appLabel: appId,
    devKey,
    devLabel: devKey,
    devEui: asString(ids?.dev_eui),
    heard: event === "up" || event === "join",
  };
}

/** ChirpStack: `application/<id>/device/...`; identity lives in the payload. */
function parseChirpstack(segments: string[], payload: string): LorawanIdentity | null {
  if (segments[0] !== "application" || !segments.includes("device")) return null;

  const msg = parseObject(payload);
  if (!msg) return null;
  const info = (msg.deviceInfo ?? null) as Record<string, unknown> | null;

  // v3 carries identity at the root; v4 nests it under deviceInfo.
  const appId = asString(msg.applicationID) ?? asString(info?.applicationId) ?? segments[1] ?? null;
  const devEui = asString(msg.devEUI) ?? asString(msg.devEui) ?? asString(info?.devEui);
  const devName = asString(msg.deviceName) ?? asString(info?.deviceName);
  // A real ChirpStack message identifies itself; bail otherwise so we don't
  // claim arbitrary application/<x>/device/... topics.
  if (!appId || (!devEui && !devName && !info)) return null;

  const devKey = devEui ?? devName!;
  // Event type appears either side of the EUI across versions; treat the
  // presence of an "up"/"join" segment as "heard".
  const heard = segments.includes("up") || segments.includes("rx") || segments.includes("join");
  return {
    ecoId: "chirpstack",
    appId,
    appLabel: asString(msg.applicationName) ?? asString(info?.applicationName) ?? appId,
    devKey,
    devLabel: devName ?? devEui,
    devEui,
    heard,
  };
}

/**
 * Main-thread hook: a message arrived that might be a LoRaWAN uplink. Builds
 * the application -> device entity tree, binds the node, and marks the device
 * online when it was heard. Returns null for non-LoRaWAN topics.
 */
export function recordLorawanMessage(
  registry: EntityRegistry,
  topic: string,
  nodeId: string,
  payload: string,
): LorawanHit | null {
  const segments = topic.split("/");
  const id = parseTtn(segments, payload) ?? parseChirpstack(segments, payload);
  if (!id) return null;

  // Application — a grouping parent.
  const appResult = ensureEntity(registry, {
    key: `${id.ecoId}:app:${id.appId}`,
    ecosystem: id.ecoId,
    role: "application",
    label: id.appLabel ?? id.appId,
    parentKey: null,
  });
  if (!appResult) return null;
  let changed = appResult.created;
  // A later message may carry the human application name the first one lacked.
  if (id.appLabel && appResult.entity.label !== id.appLabel) {
    appResult.entity.label = id.appLabel;
    changed = true;
  }

  // Device — the topic's owner and click-to-select target.
  const devResult = ensureEntity(registry, {
    key: `${id.ecoId}:dev:${id.appId}/${id.devKey}`,
    ecosystem: id.ecoId,
    role: "device",
    label: id.devLabel ?? id.devKey,
    parentKey: `${id.ecoId}:app:${id.appId}`,
    attributes: id.devEui ? { dev_eui: id.devEui } : {},
  });
  if (!devResult) return { entity: appResult.entity, changed };
  const dev = devResult.entity;
  if (devResult.created) changed = true;

  if (id.devLabel && dev.label !== id.devLabel) {
    dev.label = id.devLabel;
    changed = true;
  }
  if (id.devEui && dev.attributes.dev_eui !== id.devEui) {
    dev.attributes.dev_eui = id.devEui;
    changed = true;
  }

  if (!dev.topicNodeIds.has(nodeId)) {
    (dev.topicNodeIds as Set<string>).add(nodeId);
    changed = true;
  }

  // Anchor at the uplink topic when we can; otherwise first-seen.
  const isUplink = segments[segments.length - 1] === "up" || segments.includes("up");
  if (isUplink) {
    if (dev.anchorTopicId !== nodeId) {
      dev.anchorTopicId = nodeId;
      changed = true;
    }
  } else if (dev.anchorTopicId === null) {
    dev.anchorTopicId = nodeId;
    changed = true;
  }

  // Heard from = alive. LoRaWAN has no clean offline signal, so once true it
  // stays true (sleepy devices are intermittent, not "dead").
  if (id.heard && dev.online !== true) {
    dev.online = true;
    changed = true;
  }

  return { entity: dev, changed };
}
