import type { SparkplugDeviceState } from "../../types/sparkplug";
import type { DomainEntity } from "../../types/entities";

/**
 * Read-only projection of the sparkplug device slice into the generic
 * DomainEntity shape. The sparkplug slice keeps its tuned write path
 * (batched version bumps, death cascade, heartbeat gating); this facade
 * adapts it for entity-level UI without migrating it (issue #54).
 */

/** Message-type segment of a sparkplug topic ("spBv1.0/group/TYPE/edge[/device]"). */
function topicMessageType(topicId: string): string {
  return topicId.split("/")[2] ?? "";
}

/**
 * Pick the topic node that best represents the entity for click-to-select:
 * the live DATA branch when present, else BIRTH, else the first recorded.
 */
function pickAnchorTopic(topicNodeIds: ReadonlySet<string>): string | null {
  let birth: string | null = null;
  let first: string | null = null;
  for (const id of topicNodeIds) {
    if (first === null) first = id;
    const type = topicMessageType(id);
    if (type === "NDATA" || type === "DDATA") return id;
    if (birth === null && (type === "NBIRTH" || type === "DBIRTH")) birth = id;
  }
  return birth ?? first;
}

/** Project one sparkplug device state into a DomainEntity. */
function toEntity(d: SparkplugDeviceState): DomainEntity {
  return {
    key: `sparkplug:${d.deviceKey}`,
    ecosystem: "sparkplug",
    role: d.role,
    label: d.deviceId ?? d.edgeNodeId,
    parentKey:
      d.role === "device" ? `sparkplug:${d.groupId}/${d.edgeNodeId}` : null,
    online: d.online,
    attributes: {
      group: d.groupId,
      edgeNode: d.edgeNodeId,
      metrics: String(d.metrics.size),
    },
    anchorTopicId: pickAnchorTopic(d.topicNodeIds),
    topicNodeIds: d.topicNodeIds,
  };
}

/**
 * All sparkplug entities, sorted by key — which naturally places each edge
 * node ("group/edge") directly before its devices ("group/edge/device").
 */
export function sparkplugEntitiesView(
  devices: ReadonlyMap<string, SparkplugDeviceState>,
): DomainEntity[] {
  const entities = [...devices.values()].map(toEntity);
  entities.sort((a, b) => a.key.localeCompare(b.key));
  return entities;
}
