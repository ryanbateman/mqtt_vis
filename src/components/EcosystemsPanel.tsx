import { useEffect, useMemo } from "react";
import { useTopicStore } from "../stores/topicStore";
import { sparkplugEntitiesView } from "../utils/ecosystems/sparkplugFacade";
import { getEcosystemDefinition } from "../utils/ecosystemRegistry";
import type { DomainEntity } from "../types/entities";

/**
 * All identified domain entities — the sparkplug facade plus the
 * discovery-based entity registry — re-derived when either slice changes.
 * Used by the Ecosystems rail section (badge + content).
 */
export function useDomainEntities(): DomainEntity[] {
  // Version subscriptions drive re-renders; the Maps are mutated in place.
  const sparkplugVersion = useTopicStore((s) => s.sparkplugVersion);
  const entitiesVersion = useTopicStore((s) => s.entitiesVersion);
  return useMemo(() => {
    const state = useTopicStore.getState();
    return [
      ...sparkplugEntitiesView(state.sparkplugDevices),
      ...state.domainEntities.values(),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sparkplugVersion, entitiesVersion]);
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

/** Section heading: ecosystem colour dot, label, and entity count. */
function SectionHeading({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
        {label}
      </span>
      <span className="ml-auto text-[10px] font-mono text-gray-500">{count}</span>
    </div>
  );
}

/** Sparkplug section: group → edge node → devices. */
function SparkplugSection({ entities }: { entities: DomainEntity[] }) {
  const def = getEcosystemDefinition("sparkplug");
  const groups = groupSparkplug(entities);

  return (
    <div>
      <SectionHeading color={def.color} label={def.label} count={entities.length} />
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

/** Home Assistant section: devices with their entities, orphan entities flat. */
function HomeAssistantSection({ entities }: { entities: DomainEntity[] }) {
  const def = getEcosystemDefinition("homeassistant");

  const byLabel = (a: DomainEntity, b: DomainEntity) => a.label.localeCompare(b.label);
  const devices = entities.filter((e) => e.role === "device").sort(byLabel);
  const childrenByParent = new Map<string, DomainEntity[]>();
  const orphans: DomainEntity[] = [];
  for (const e of entities) {
    if (e.role === "device") continue;
    const parent = e.parentKey ? childrenByParent.get(e.parentKey) : undefined;
    if (e.parentKey && entities.some((d) => d.key === e.parentKey)) {
      if (parent) parent.push(e);
      else childrenByParent.set(e.parentKey, [e]);
    } else {
      orphans.push(e);
    }
  }
  for (const children of childrenByParent.values()) children.sort(byLabel);
  orphans.sort(byLabel);

  return (
    <div>
      <SectionHeading color={def.color} label={def.label} count={entities.length} />
      {devices.map((device) => (
        <div key={device.key}>
          <EntityRow
            entity={device}
            extraHighlightIds={(childrenByParent.get(device.key) ?? []).map((c) => c.topicNodeIds)}
            color={def.color}
            indent={false}
          />
          {(childrenByParent.get(device.key) ?? []).map((child) => (
            <EntityRow key={child.key} entity={child} color={def.color} indent />
          ))}
        </div>
      ))}
      {orphans.map((entity) => (
        <EntityRow key={entity.key} entity={entity} color={def.color} indent={false} />
      ))}
    </div>
  );
}

/**
 * Ecosystems rail content: identified domain objects (Sparkplug B edge
 * nodes/devices, Home Assistant devices/entities) as a navigable tree,
 * cross-linked to the graph — hovering a row highlights the entity's topic
 * nodes, clicking selects its anchor topic.
 */
export function EcosystemsPanel({ entities }: { entities: DomainEntity[] }) {
  const clearHighlights = useTopicStore((s) => s.clearHighlights);

  // Don't leave stale highlights behind when the panel disappears
  // (disconnect clears the entity slices while a row is hovered).
  useEffect(() => {
    return () => clearHighlights();
  }, [clearHighlights]);

  const sparkplug = entities.filter((e) => e.ecosystem === "sparkplug");
  const homeassistant = entities.filter((e) => e.ecosystem === "homeassistant");

  return (
    <div className="p-2 space-y-2">
      {sparkplug.length > 0 && <SparkplugSection entities={sparkplug} />}
      {homeassistant.length > 0 && <HomeAssistantSection entities={homeassistant} />}
    </div>
  );
}
