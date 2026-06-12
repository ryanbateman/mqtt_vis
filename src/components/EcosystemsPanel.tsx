import { useEffect, useMemo } from "react";
import { useTopicStore } from "../stores/topicStore";
import { sparkplugEntitiesView } from "../utils/ecosystems/sparkplugFacade";
import { getEcosystemDefinition } from "../utils/ecosystemRegistry";
import type { DomainEntity } from "../types/entities";

/**
 * All identified domain entities, re-derived when the underlying ecosystem
 * state changes. Used by the Ecosystems rail section (badge + content).
 */
export function useDomainEntities(): DomainEntity[] {
  // Version subscription drives re-renders; the Map itself is mutated in place.
  const sparkplugVersion = useTopicStore((s) => s.sparkplugVersion);
  return useMemo(() => {
    return sparkplugEntitiesView(useTopicStore.getState().sparkplugDevices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sparkplugVersion]);
}

/** One edge node (or orphan-device family) within a sparkplug group. */
interface EdgeFamily {
  /** Edge node ID (from the entity or, for orphans, the device's attributes). */
  edgeId: string;
  /** The edge-node entity itself, if its messages have been seen. */
  edge: DomainEntity | null;
  devices: DomainEntity[];
}

/**
 * Group sparkplug entities into group → edge node → devices. Devices whose
 * edge node has not published any node-level message still get a family,
 * headed by the edge ID alone.
 */
function groupSparkplug(entities: DomainEntity[]): Map<string, EdgeFamily[]> {
  const groups = new Map<string, Map<string, EdgeFamily>>();
  for (const e of entities) {
    const groupId = e.attributes.group ?? "";
    const edgeId = e.attributes.edgeNode ?? e.label;
    let families = groups.get(groupId);
    if (!families) {
      families = new Map();
      groups.set(groupId, families);
    }
    let family = families.get(edgeId);
    if (!family) {
      family = { edgeId, edge: null, devices: [] };
      families.set(edgeId, family);
    }
    if (e.role === "edge-node") {
      family.edge = e;
    } else {
      family.devices.push(e);
    }
  }
  const result = new Map<string, EdgeFamily[]>();
  for (const [groupId, families] of groups) {
    result.set(groupId, [...families.values()]);
  }
  return result;
}

/** Online state dot: emerald online, red offline, gray unknown. */
function StatusDot({ online }: { online: boolean | null }) {
  const color =
    online === null ? "bg-gray-500" : online ? "bg-emerald-400" : "bg-red-400";
  return <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />;
}

/** One clickable entity row: hover highlights its topic nodes, click selects its anchor. */
function EntityRow({
  entity,
  extraHighlightIds,
  color,
  indent,
}: {
  entity: DomainEntity;
  /** Additional topic node IDs to highlight on hover (e.g. an edge's devices). */
  extraHighlightIds?: ReadonlySet<string>[];
  color: string;
  indent: boolean;
}) {
  const setHighlightedNodes = useTopicStore((s) => s.setHighlightedNodes);
  const clearHighlights = useTopicStore((s) => s.clearHighlights);
  const setSelectedNodeId = useTopicStore((s) => s.setSelectedNodeId);
  const selectedNodeId = useTopicStore((s) => s.selectedNodeId);

  const isSelected =
    selectedNodeId !== null && entity.topicNodeIds.has(selectedNodeId);

  const handleEnter = () => {
    const map = new Map<string, string>();
    for (const id of entity.topicNodeIds) map.set(id, color);
    for (const ids of extraHighlightIds ?? []) {
      for (const id of ids) map.set(id, color);
    }
    setHighlightedNodes(map);
  };

  const metricCount = entity.attributes.metrics;

  return (
    <button
      type="button"
      onMouseEnter={handleEnter}
      onMouseLeave={clearHighlights}
      onClick={() => {
        if (entity.anchorTopicId) setSelectedNodeId(entity.anchorTopicId);
      }}
      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left transition-colors hover:bg-gray-700/50 ${
        isSelected ? "bg-gray-700/70" : ""
      } ${indent ? "pl-5" : ""}`}
      title={entity.anchorTopicId ?? undefined}
    >
      <StatusDot online={entity.online} />
      <span className="font-mono text-[11px] text-gray-200 truncate flex-1">
        {entity.label}
      </span>
      <span className="text-[9px] uppercase tracking-wider text-gray-500 flex-shrink-0">
        {entity.role === "edge-node" ? "edge" : entity.role}
      </span>
      {metricCount !== undefined && metricCount !== "0" && (
        <span className="text-[10px] font-mono text-gray-500 flex-shrink-0">
          {metricCount}m
        </span>
      )}
    </button>
  );
}

/**
 * Ecosystems rail content: identified domain objects (currently Sparkplug B
 * edge nodes and devices) as a navigable tree, cross-linked to the graph —
 * hovering a row highlights the entity's topic nodes, clicking selects its
 * anchor topic (which switches to the Insights section's device view).
 */
export function EcosystemsPanel({ entities }: { entities: DomainEntity[] }) {
  const clearHighlights = useTopicStore((s) => s.clearHighlights);

  // Don't leave stale highlights behind when the panel disappears
  // (disconnect clears the device slice while a row is hovered).
  useEffect(() => {
    return () => clearHighlights();
  }, [clearHighlights]);

  const def = getEcosystemDefinition("sparkplug");
  const groups = groupSparkplug(entities);

  return (
    <div className="p-2">
      {/* Ecosystem section heading */}
      <div className="flex items-center gap-1.5 px-2 py-1">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: def.color }}
        />
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
          {def.label}
        </span>
        <span className="ml-auto text-[10px] font-mono text-gray-500">
          {entities.length}
        </span>
      </div>

      {[...groups.entries()].map(([groupId, families]) => (
        <div key={groupId}>
          <div className="px-2 pt-1 text-[10px] text-gray-500 font-mono truncate">
            {groupId}
          </div>
          {families.map((family) => (
            <div key={family.edgeId}>
              {family.edge ? (
                <EntityRow
                  entity={family.edge}
                  extraHighlightIds={family.devices.map((d) => d.topicNodeIds)}
                  color={def.color}
                  indent={false}
                />
              ) : (
                <div className="px-2 py-1 pl-5 text-[11px] font-mono text-gray-500 truncate">
                  {family.edgeId}
                </div>
              )}
              {family.devices.map((device) => (
                <EntityRow
                  key={device.key}
                  entity={device}
                  color={def.color}
                  indent
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
