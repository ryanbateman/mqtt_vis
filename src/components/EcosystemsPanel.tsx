import { useEffect, useMemo, useState } from "react";
import { useTopicStore } from "../stores/topicStore";
import { sparkplugEntitiesView } from "../utils/ecosystems/sparkplugFacade";
import { getEcosystemDefinition } from "../utils/ecosystemRegistry";
import type { DomainEntity } from "../types/entities";

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
 * Ecosystems panel: identified domain objects (currently Sparkplug B edge
 * nodes and devices) as a navigable tree, cross-linked to the graph —
 * hovering a row highlights the entity's topic nodes, clicking selects its
 * anchor topic (which auto-opens the Insights Drawer device tab).
 * Renders nothing until at least one entity is identified.
 */
export function EcosystemsPanel() {
  // Version subscription drives re-renders; the Map itself is mutated in place.
  const sparkplugVersion = useTopicStore((s) => s.sparkplugVersion);
  const clearHighlights = useTopicStore((s) => s.clearHighlights);
  const [collapsed, setCollapsed] = useState(false);

  const entities = useMemo(() => {
    return sparkplugEntitiesView(useTopicStore.getState().sparkplugDevices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sparkplugVersion]);

  // Don't leave stale highlights behind when the panel disappears
  // (disconnect clears the device slice while a row is hovered).
  useEffect(() => {
    if (entities.length === 0) clearHighlights();
  }, [entities.length, clearHighlights]);

  if (entities.length === 0) return null;

  const def = getEcosystemDefinition("sparkplug");
  const groups = groupSparkplug(entities);

  return (
    <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg p-3 shadow-xl w-72">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-gray-100 transition-colors w-full"
      >
        <svg
          className={`w-3 h-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
            clipRule="evenodd"
          />
        </svg>
        Ecosystems
        <span className="ml-auto text-[10px] font-mono text-gray-500">
          {entities.length}
        </span>
      </button>

      {/* Animated collapsible body */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${
          collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
        }`}
      >
        <div className="overflow-hidden">
          <div className="mt-2 max-h-64 overflow-y-auto">
            {/* Ecosystem section heading */}
            <div className="flex items-center gap-1.5 px-2 py-1">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: def.color }}
              />
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                {def.label}
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
        </div>
      </div>
    </div>
  );
}
