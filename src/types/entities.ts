/**
 * Ecosystem domain entities — devices, edge nodes, and sensors identified
 * from known MQTT ecosystems (design notes: GitHub issue #54).
 *
 * Today the only source is the sparkplug facade
 * (utils/ecosystems/sparkplugFacade.ts), a read-only projection of the
 * sparkplugDevices store slice. Discovery-based providers (Home Assistant,
 * zigbee2mqtt) will produce DomainEntity records directly once they land.
 */

/** Ecosystems the app knows about. Extended as providers are added. */
export type EcosystemId = "sparkplug" | "homeassistant" | "zigbee2mqtt";

/**
 * One entity parsed from an ecosystem's defining payload (e.g. a Home
 * Assistant discovery config). Travels worker → main inside a DetectorResult
 * and is applied to the entity registry by the store (entityOps.ts).
 */
export interface EntityDeclaration {
  /** Full entity key, "<ecosystem>:<stable-id>". */
  key: string;
  ecosystem: EcosystemId;
  /** Ecosystem-scoped role, e.g. "device" | "sensor" | "switch". */
  role: string;
  label: string;
  /** Key of the parent entity (entity → device). Null at the top. */
  parentKey: string | null;
  /** Small, flat, display-oriented facts. */
  attributes: Record<string, string>;
  /**
   * Topics this entity claims (state/command/attributes). The first entry is
   * the primary state topic when known — it becomes the anchor once seen.
   */
  memberTopics: string[];
  /** Availability topics with their match payloads, for online tracking. */
  availability: {
    topic: string;
    payloadAvailable: string;
    payloadNotAvailable: string;
  }[];
  /** The defining topic that produced this declaration (tombstone key). */
  sourceTopic: string;
}

/** One identified domain object: an edge node, device, or sub-device entity. */
export interface DomainEntity {
  /** Stable identity: "<ecosystem>:<ecosystem-scoped id>", e.g. "sparkplug:plant/edge-01". */
  key: string;
  ecosystem: EcosystemId;
  /** Ecosystem-scoped role, e.g. "edge-node" | "device". */
  role: string;
  /** Human-readable name (device ID, friendly name). */
  label: string;
  /** Key of the parent entity (device → edge node). Null at the top of the hierarchy. */
  parentKey: string | null;
  /** Online state. Null when the ecosystem provides no availability signal. */
  online: boolean | null;
  /** Small, flat, display-oriented facts (group, manufacturer, model, ...). */
  attributes: Record<string, string>;
  /** Topic node where this entity "lives" — the click-to-select target. */
  anchorTopicId: string | null;
  /** All topic node IDs this entity's messages have arrived on. */
  topicNodeIds: ReadonlySet<string>;
}
