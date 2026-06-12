import type { DomainEntity, EntityDeclaration } from "../../types/entities";
import { isHaDiscoveryTopic } from "./homeassistant/discovery";
import { isShellyAnnounceTopic } from "./shelly";

/**
 * Entity registry operations: pure functions over the registry's maps,
 * called by the store (topicStore.ts). The registry holds discovery-based
 * domain entities (Home Assistant today; zigbee2mqtt later) — the sparkplug
 * slice stays separate behind its read-only facade (sparkplugFacade.ts).
 */

/** Maximum tracked entities — mirrors the topic node cap's rationale. */
export const DOMAIN_ENTITY_CAP = 2000;

/** Maximum topic node IDs tracked per entity (matches SparkplugDeviceState). */
const TOPIC_NODE_IDS_CAP = 50;

/** One entity's claim on a topic, held in the reverse index. */
export interface TopicClaim {
  entityKey: string;
  /** primary = declared state topic (anchor); member = other claimed topics. */
  kind: "primary" | "member" | "availability";
  /** Availability match payloads (kind === "availability" only). */
  payloadAvailable?: string;
  payloadNotAvailable?: string;
}

/** The entity registry: entities plus the maps that keep lookups O(1). */
export interface EntityRegistry {
  entities: Map<string, DomainEntity>;
  /** Reverse index: exact topic string → claims on it. Hot-path lookup. */
  topicIndex: Map<string, TopicClaim[]>;
  /** Defining topic → entity keys it declared (tombstone handling). */
  configTopics: Map<string, string[]>;
  /** Entity key → topics it has claims on (cleanup on re-declare/remove). */
  entityTopics: Map<string, string[]>;
}

export function createEntityRegistry(): EntityRegistry {
  return {
    entities: new Map(),
    topicIndex: new Map(),
    configTopics: new Map(),
    entityTopics: new Map(),
  };
}

export function clearEntityRegistry(registry: EntityRegistry): void {
  registry.entities.clear();
  registry.topicIndex.clear();
  registry.configTopics.clear();
  registry.entityTopics.clear();
}

/**
 * True for topics that DEFINE ecosystem entities (HA discovery configs,
 * Shelly announces). These are exempt from the retained-burst drop:
 * discovery payloads are always retained, so dropping them would blind
 * the registry.
 */
export function isEcosystemDefiningTopic(topic: string): boolean {
  return isHaDiscoveryTopic(topic) || isShellyAnnounceTopic(topic);
}

/**
 * Ordered longest-first prefix match against a lowercase table. Shared by
 * providers that classify devices from topic ids (Shelly today; WLED and
 * Tasmota pattern rules later). The input is lowercased before matching.
 */
export function matchPrefix(
  table: readonly [prefix: string, value: string][],
  input: string,
): string | null {
  const lower = input.toLowerCase();
  for (const [prefix, value] of table) {
    if (lower.startsWith(prefix)) return value;
  }
  return null;
}

/**
 * Get or create an entity for a structural provider (topic-shape-derived,
 * no defining document — Frigate cameras, announce-less Shelly devices).
 * Honours the entity cap. Returns null when the cap blocks creation.
 */
export function ensureEntity(
  registry: EntityRegistry,
  template: Omit<DomainEntity, "online" | "attributes" | "anchorTopicId" | "topicNodeIds"> &
    Partial<Pick<DomainEntity, "online" | "attributes">>,
): { entity: DomainEntity; created: boolean } | null {
  const existing = registry.entities.get(template.key);
  if (existing) return { entity: existing, created: false };
  if (registry.entities.size >= DOMAIN_ENTITY_CAP) return null;

  const entity: DomainEntity = {
    key: template.key,
    ecosystem: template.ecosystem,
    role: template.role,
    label: template.label,
    parentKey: template.parentKey,
    online: template.online ?? null,
    attributes: template.attributes ?? {},
    anchorTopicId: null,
    topicNodeIds: new Set<string>(),
  };
  registry.entities.set(template.key, entity);
  return { entity, created: true };
}

/** Remove all of one entity's claims from the reverse index. */
function removeClaims(registry: EntityRegistry, entityKey: string): void {
  const topics = registry.entityTopics.get(entityKey);
  if (!topics) return;
  for (const topic of topics) {
    const claims = registry.topicIndex.get(topic);
    if (!claims) continue;
    const remaining = claims.filter((c) => c.entityKey !== entityKey);
    if (remaining.length > 0) registry.topicIndex.set(topic, remaining);
    else registry.topicIndex.delete(topic);
  }
  registry.entityTopics.delete(entityKey);
}

/** Add one claim to the index and the per-entity topic list. */
function addClaim(registry: EntityRegistry, topic: string, claim: TopicClaim): void {
  const claims = registry.topicIndex.get(topic);
  if (claims) {
    if (!claims.some((c) => c.entityKey === claim.entityKey && c.kind === claim.kind)) {
      claims.push(claim);
    }
  } else {
    registry.topicIndex.set(topic, [claim]);
  }
  const topics = registry.entityTopics.get(claim.entityKey);
  if (topics) {
    if (!topics.includes(topic)) topics.push(topic);
  } else {
    registry.entityTopics.set(claim.entityKey, [topic]);
  }
}

/**
 * Upsert declared entities and (re)register their topic claims.
 * Existing live state (online, anchor, seen topics) is preserved across
 * re-declarations. Returns true when anything changed.
 */
export function applyEntityDeclarations(
  registry: EntityRegistry,
  declarations: EntityDeclaration[],
): boolean {
  let changed = false;

  for (const decl of declarations) {
    const existing = registry.entities.get(decl.key);
    if (!existing && registry.entities.size >= DOMAIN_ENTITY_CAP) continue;

    const entity: DomainEntity = existing ?? {
      key: decl.key,
      ecosystem: decl.ecosystem,
      role: decl.role,
      label: decl.label,
      parentKey: decl.parentKey,
      online: null,
      attributes: {},
      anchorTopicId: null,
      topicNodeIds: new Set<string>(),
    };
    entity.role = decl.role;
    entity.label = decl.label;
    // A device block in one config may name a parent another config omitted.
    if (decl.parentKey !== null) entity.parentKey = decl.parentKey;
    Object.assign(entity.attributes, decl.attributes);
    registry.entities.set(decl.key, entity);

    // Re-register claims from scratch — a config update may change topics.
    // Devices declare no topics of their own, so skip the wipe for them
    // (their declaration repeats with every sibling entity's config).
    if (decl.memberTopics.length > 0 || decl.availability.length > 0) {
      removeClaims(registry, decl.key);
      decl.memberTopics.forEach((topic, i) => {
        addClaim(registry, topic, {
          entityKey: decl.key,
          kind: i === 0 ? "primary" : "member",
        });
      });
      for (const avail of decl.availability) {
        addClaim(registry, avail.topic, {
          entityKey: decl.key,
          kind: "availability",
          payloadAvailable: avail.payloadAvailable,
          payloadNotAvailable: avail.payloadNotAvailable,
        });
      }
    }

    // Track which defining topic declared this entity (tombstones).
    const declared = registry.configTopics.get(decl.sourceTopic);
    if (declared) {
      if (!declared.includes(decl.key)) declared.push(decl.key);
    } else {
      registry.configTopics.set(decl.sourceTopic, [decl.key]);
    }

    changed = true;
  }

  return changed;
}

/**
 * Handle an empty retained payload on a defining topic: the entity it
 * declared is removed. A parent device is removed too once its last child
 * goes. Returns true when anything was removed.
 */
export function applyConfigTombstone(registry: EntityRegistry, sourceTopic: string): boolean {
  const keys = registry.configTopics.get(sourceTopic);
  if (!keys || keys.length === 0) return false;
  registry.configTopics.delete(sourceTopic);

  let changed = false;
  const parentKeys = new Set<string>();

  for (const key of keys) {
    const entity = registry.entities.get(key);
    if (!entity) continue;
    // Devices are re-declared by every sibling config — only remove the
    // device here if it has no other children (checked below).
    if (entity.role === "device") {
      parentKeys.add(key);
      continue;
    }
    if (entity.parentKey) parentKeys.add(entity.parentKey);
    registry.entities.delete(key);
    removeClaims(registry, key);
    changed = true;
  }

  // Drop devices whose last child just disappeared.
  for (const parentKey of parentKeys) {
    let hasChildren = false;
    for (const entity of registry.entities.values()) {
      if (entity.parentKey === parentKey) {
        hasChildren = true;
        break;
      }
    }
    if (!hasChildren && registry.entities.delete(parentKey)) {
      removeClaims(registry, parentKey);
      changed = true;
    }
  }

  return changed;
}

/**
 * A topic node was pruned from the tree: drop it from every claiming
 * entity's seen-topics set and re-anchor entities that pointed at it
 * (falling back to any other seen member, else null). The claims and the
 * entity itself stay — definitions are removed only by tombstones; if the
 * topic publishes again, the recreated node re-binds on the next hit.
 * Returns true when anything changed.
 */
export function removeEntityNodeRef(registry: EntityRegistry, nodeId: string): boolean {
  const claims = registry.topicIndex.get(nodeId);
  if (!claims || claims.length === 0) return false;

  let changed = false;
  for (const claim of claims) {
    const entity = registry.entities.get(claim.entityKey);
    if (!entity) continue;
    if ((entity.topicNodeIds as Set<string>).delete(nodeId)) changed = true;
    if (entity.anchorTopicId === nodeId) {
      entity.anchorTopicId = entity.topicNodeIds.values().next().value ?? null;
      changed = true;
    }
  }
  return changed;
}

/** Result of a hot-path topic hit: the matched entity plus what changed. */
export interface TopicHitResult {
  /** First matched entity — drives the slim node tag. */
  entity: DomainEntity;
  /** True when registry state changed (anchor, online, new member node). */
  changed: boolean;
}

/**
 * Hot-path hook: a message arrived on a topic some entity claims. Records
 * the topic node against the entity, sets/upgrades the anchor (primary
 * claim wins), and flips online state on availability payload matches.
 * One Map.get per message; returns null for unclaimed topics.
 */
export function recordEntityTopicHit(
  registry: EntityRegistry,
  topic: string,
  nodeId: string,
  payload: string,
): TopicHitResult | null {
  const claims = registry.topicIndex.get(topic);
  if (!claims || claims.length === 0) return null;

  let first: DomainEntity | null = null;
  let changed = false;

  for (const claim of claims) {
    const entity = registry.entities.get(claim.entityKey);
    if (!entity) continue;
    first ??= entity;

    if (!entity.topicNodeIds.has(nodeId) && entity.topicNodeIds.size < TOPIC_NODE_IDS_CAP) {
      (entity.topicNodeIds as Set<string>).add(nodeId);
      changed = true;
    }

    if (claim.kind === "primary") {
      if (entity.anchorTopicId !== nodeId) {
        entity.anchorTopicId = nodeId;
        changed = true;
      }
    } else if (entity.anchorTopicId === null && claim.kind === "member") {
      entity.anchorTopicId = nodeId;
      changed = true;
    }

    if (claim.kind === "availability") {
      const online =
        payload === claim.payloadAvailable
          ? true
          : payload === claim.payloadNotAvailable
            ? false
            : entity.online;
      if (online !== entity.online) {
        entity.online = online;
        changed = true;
      }
    }
  }

  return first ? { entity: first, changed } : null;
}
