import type { DetectorResult, HomeAssistantMetadata } from "../../../types/payloadTags";
import type { EntityDeclaration } from "../../../types/entities";
import {
  expandConfig,
  expandDeviceBlock,
  expandAvailabilityItem,
  substituteBase,
} from "./abbreviations";

/**
 * Home Assistant MQTT discovery parser.
 *
 * Discovery configs are retained JSON documents that *declare* entities:
 *   homeassistant/<component>/[<node_id>/]<object_id>/config   (per-entity)
 *   homeassistant/device/<object_id>/config                    (device-based)
 *
 * The parser produces EntityDeclarations: a device entity (from the `device`
 * block, deduplicated by identifier across configs) plus one entity per
 * component config, with the topics each claims (state/command/attributes)
 * and availability topics for online tracking. Pure — runs in the analyzer
 * worker (detectHomeAssistant) and is applied to the registry by the store.
 */

/** True for HA discovery config topics (both per-entity and device-based shapes). */
export function isHaDiscoveryTopic(topic: string): boolean {
  if (!topic.startsWith("homeassistant/") || !topic.endsWith("/config")) return false;
  const segments = topic.split("/").length;
  return segments === 4 || segments === 5;
}

/** Availability spec collected from a config. */
type Availability = EntityDeclaration["availability"][number];

/** Parse the availability list / single-topic forms into specs. */
function collectAvailability(
  cfg: Record<string, unknown>,
  base: string,
): Availability[] {
  const out: Availability[] = [];
  const defaults = {
    payloadAvailable: typeof cfg.payload_available === "string" ? cfg.payload_available : "online",
    payloadNotAvailable:
      typeof cfg.payload_not_available === "string" ? cfg.payload_not_available : "offline",
  };

  if (Array.isArray(cfg.availability)) {
    for (const rawItem of cfg.availability) {
      if (typeof rawItem !== "object" || rawItem === null) continue;
      const item = expandAvailabilityItem(rawItem as Record<string, unknown>);
      if (typeof item.topic !== "string") continue;
      out.push({
        topic: substituteBase(item.topic, base),
        payloadAvailable:
          typeof item.payload_available === "string" ? item.payload_available : defaults.payloadAvailable,
        payloadNotAvailable:
          typeof item.payload_not_available === "string"
            ? item.payload_not_available
            : defaults.payloadNotAvailable,
      });
    }
  } else if (typeof cfg.availability_topic === "string") {
    out.push({
      topic: substituteBase(cfg.availability_topic, base),
      ...defaults,
    });
  }
  return out;
}

/**
 * Collect all topic-valued keys from an expanded config: known long names
 * plus the generic "_t"/"_topic" suffix rule for abbreviations the tables
 * don't cover (bri_stat_t, pos_t, ...). The state topic sorts first — it
 * becomes the entity's anchor once seen. Availability topics are excluded
 * (tracked separately for online state).
 */
function collectMemberTopics(cfg: Record<string, unknown>, base: string): string[] {
  const topics: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== "string" || value.length === 0) return;
    const expanded = substituteBase(value, base);
    if (!topics.includes(expanded)) topics.push(expanded);
  };

  push(cfg.state_topic);
  for (const [key, value] of Object.entries(cfg)) {
    if (key === "availability_topic" || key === "state_topic") continue;
    if (key.endsWith("_topic") || key.endsWith("_t")) push(value);
  }
  return topics;
}

/** Device identity + declaration parsed from a config's device block. */
function parseDeviceBlock(
  cfg: Record<string, unknown>,
  sourceTopic: string,
): { key: string; declaration: EntityDeclaration } | null {
  if (typeof cfg.device !== "object" || cfg.device === null) return null;
  const dev = expandDeviceBlock(cfg.device as Record<string, unknown>);

  // Stable identity: first identifier, else first connection pair joined.
  let id: string | null = null;
  if (typeof dev.identifiers === "string") id = dev.identifiers;
  else if (Array.isArray(dev.identifiers) && dev.identifiers.length > 0) {
    id = String(dev.identifiers[0]);
  } else if (Array.isArray(dev.connections) && Array.isArray(dev.connections[0])) {
    id = (dev.connections[0] as unknown[]).map(String).join(":");
  }
  if (!id) return null;

  const key = `homeassistant:dev:${id}`;
  const attributes: Record<string, string> = {};
  for (const attr of ["manufacturer", "model", "sw_version", "hw_version"] as const) {
    if (typeof dev[attr] === "string" && dev[attr]) attributes[attr] = dev[attr] as string;
  }

  return {
    key,
    declaration: {
      key,
      ecosystem: "homeassistant",
      role: "device",
      label: typeof dev.name === "string" && dev.name ? dev.name : id,
      parentKey: null,
      attributes,
      memberTopics: [],
      availability: [],
      sourceTopic,
    },
  };
}

/** Build the declaration for one entity config (already abbreviation-expanded). */
function buildEntityDeclaration(
  cfg: Record<string, unknown>,
  component: string,
  fallbackId: string,
  base: string,
  deviceKey: string | null,
  sharedAvailability: Availability[],
  sourceTopic: string,
): EntityDeclaration {
  const uniqueId = typeof cfg.unique_id === "string" && cfg.unique_id ? cfg.unique_id : null;
  const key = uniqueId
    ? `homeassistant:ent:${uniqueId}`
    : `homeassistant:ent:${component}.${fallbackId}`;

  const attributes: Record<string, string> = { component };
  if (typeof cfg.device_class === "string" && cfg.device_class) {
    attributes.device_class = cfg.device_class;
  }

  const ownAvailability = collectAvailability(cfg, base);
  return {
    key,
    ecosystem: "homeassistant",
    role: component,
    label: typeof cfg.name === "string" && cfg.name ? cfg.name : fallbackId,
    parentKey: deviceKey,
    attributes,
    memberTopics: collectMemberTopics(cfg, base),
    availability: ownAvailability.length > 0 ? ownAvailability : sharedAvailability,
    sourceTopic,
  };
}

/**
 * Parse one discovery config into declarations: the device (when a device
 * block exists) followed by its entit(y/ies). Returns [] for anything that
 * is not a parseable discovery config.
 */
export function parseHaDiscovery(topic: string, payload: string): EntityDeclaration[] {
  if (!isHaDiscoveryTopic(topic) || payload.length === 0) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return [];
  }
  if (typeof raw !== "object" || raw === null) return [];

  const segments = topic.split("/");
  const component = segments[1];
  const objectId = segments.length === 5 ? `${segments[2]}.${segments[3]}` : segments[2];

  const cfg = expandConfig(raw as Record<string, unknown>);
  const base = typeof cfg["~"] === "string" ? (cfg["~"] as string) : "";
  const device = parseDeviceBlock(cfg, topic);
  const declarations: EntityDeclaration[] = device ? [device.declaration] : [];

  if (component === "device") {
    // Device-based discovery: one payload declares the device plus a
    // `components` map of entity configs sharing the base topic and
    // top-level availability.
    if (!device || typeof cfg.components !== "object" || cfg.components === null) {
      return declarations;
    }
    const sharedAvailability = collectAvailability(cfg, base);
    for (const [componentId, rawComp] of Object.entries(cfg.components as Record<string, unknown>)) {
      if (typeof rawComp !== "object" || rawComp === null) continue;
      const comp = expandConfig(rawComp as Record<string, unknown>);
      const platform = typeof comp.platform === "string" ? comp.platform : null;
      if (!platform) continue;
      declarations.push(
        buildEntityDeclaration(
          comp,
          platform,
          `${objectId}.${componentId}`,
          typeof comp["~"] === "string" ? (comp["~"] as string) : base,
          device.key,
          sharedAvailability,
          topic,
        ),
      );
    }
    return declarations;
  }

  declarations.push(
    buildEntityDeclaration(cfg, component, objectId, base, device?.key ?? null, [], topic),
  );
  return declarations;
}

/**
 * Worker phase-1 detector: discovery config topics yield a homeassistant
 * tag carrying the parsed declarations (stripped into the entity registry
 * by setPayloadTags). Non-discovery topics yield nothing.
 */
export function detectHomeAssistant(topic: string, payload: string): DetectorResult[] {
  const declarations = parseHaDiscovery(topic, payload);
  if (declarations.length === 0) return [];

  const entity = declarations.find((d) => d.role !== "device") ?? declarations[0];
  const metadata: HomeAssistantMetadata = {
    entityKey: entity.key,
    role: entity.role,
    label: entity.label,
    online: null,
    declarations,
  };
  return [{ tag: "homeassistant", confidence: 1, fieldPath: "", metadata }];
}
