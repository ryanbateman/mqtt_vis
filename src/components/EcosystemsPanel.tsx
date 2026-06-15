import { useEffect, useMemo, useState } from "react";
import { useTopicStore } from "../stores/topicStore";
import { sparkplugEntitiesView } from "../utils/ecosystems/sparkplugFacade";
import { getEcosystemDefinition } from "../utils/ecosystemRegistry";
import type { DomainEntity, EcosystemId } from "../types/entities";

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

/**
 * One clickable entity row: hover highlights its topic nodes, click selects
 * its anchor. Parents pass onToggle to get a collapse chevron (with a child
 * count while collapsed).
 */
function EntityRow({
  entity,
  extraHighlightIds,
  color,
  indent,
  childCount = 0,
  expanded = false,
  onToggle,
}: {
  entity: DomainEntity;
  /** Additional topic node IDs to highlight on hover (e.g. an edge's devices). */
  extraHighlightIds?: ReadonlySet<string>[];
  color: string;
  indent: boolean;
  /** Number of child rows (shown while collapsed). */
  childCount?: number;
  expanded?: boolean;
  /** When set, the row gets a collapse chevron. */
  onToggle?: () => void;
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
    <div
      role="button"
      tabIndex={0}
      onMouseEnter={handleEnter}
      onMouseLeave={clearHighlights}
      onClick={() => {
        if (entity.anchorTopicId) setSelectedNodeId(entity.anchorTopicId);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && entity.anchorTopicId) {
          setSelectedNodeId(entity.anchorTopicId);
        }
      }}
      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left transition-colors cursor-pointer hover:bg-gray-700/50 ${
        isSelected ? "bg-gray-700/70" : ""
      } ${indent ? "pl-5" : ""}`}
      title={entity.anchorTopicId ?? undefined}
    >
      {onToggle && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          title={expanded ? "Collapse" : "Expand"}
          className="p-0.5 -ml-1 text-gray-500 hover:text-gray-200 transition-colors flex-shrink-0"
        >
          <svg
            className={`w-2.5 h-2.5 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
      <StatusDot online={entity.online} />
      <span className="font-mono text-[11px] text-gray-200 truncate flex-1">
        {entity.label}
      </span>
      {onToggle && !expanded && childCount > 0 && (
        <span className="text-[10px] font-mono text-gray-500 flex-shrink-0">
          {childCount}
        </span>
      )}
      <span className="text-[9px] uppercase tracking-wider text-gray-500 flex-shrink-0">
        {entity.attributes.type ??
          (entity.role === "edge-node" ? "edge" : entity.role)}
      </span>
      {metricCount !== undefined && metricCount !== "0" && (
        <span
          className="text-[10px] font-mono text-gray-500 flex-shrink-0"
          title={`${metricCount} decoded metrics`}
        >
          {metricCount}m
        </span>
      )}
    </div>
  );
}

/**
 * Per-section expansion state. Parents default expanded in small sections
 * (≤ EXPAND_ALL_THRESHOLD entities) and collapsed in large ones; user
 * toggles are stored as exceptions to that default.
 */
const EXPAND_ALL_THRESHOLD = 12;

function useExpansion(sectionSize: number) {
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const defaultExpanded = sectionSize <= EXPAND_ALL_THRESHOLD;
  const isExpanded = (key: string) =>
    toggled.has(key) ? !defaultExpanded : defaultExpanded;
  const toggle = (key: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return { isExpanded, toggle };
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
  const { isExpanded, toggle } = useExpansion(entities.length);

  return (
    <div>
      <SectionHeading color={def.color} label={def.label} count={entities.length} />
      {[...groups.entries()].map(([groupId, families]) => (
        <div key={groupId}>
          <div className="px-2 pt-1 text-[10px] text-gray-500 font-mono truncate">
            {groupId}
          </div>
          {families.map((family) => {
            const familyKey = family.edge?.key ?? `${groupId}/${family.edgeId}`;
            const expanded = family.devices.length === 0 || isExpanded(familyKey);
            return (
              <div key={family.edgeId}>
                {family.edge ? (
                  <EntityRow
                    entity={family.edge}
                    extraHighlightIds={family.devices.map((d) => d.topicNodeIds)}
                    color={def.color}
                    indent={false}
                    childCount={family.devices.length}
                    expanded={expanded}
                    onToggle={family.devices.length > 0 ? () => toggle(familyKey) : undefined}
                  />
                ) : (
                  <div className="px-2 py-1 pl-5 text-[11px] font-mono text-gray-500 truncate">
                    {family.edgeId}
                  </div>
                )}
                {expanded &&
                  family.devices.map((device) => (
                    <EntityRow
                      key={device.key}
                      entity={device}
                      color={def.color}
                      indent
                    />
                  ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Generic parent/child section for registry-backed ecosystems: entities
 * whose parentKey resolves nest under that parent (HA device → entities,
 * Frigate NVR → cameras); the rest render flat (Shelly's flat device list).
 */
function EntityTreeSection({
  ecosystemId,
  entities,
}: {
  ecosystemId: EcosystemId;
  entities: DomainEntity[];
}) {
  const def = getEcosystemDefinition(ecosystemId);
  const { isExpanded, toggle } = useExpansion(entities.length);

  const byLabel = (a: DomainEntity, b: DomainEntity) => a.label.localeCompare(b.label);
  const keys = new Set(entities.map((e) => e.key));
  const childrenByParent = new Map<string, DomainEntity[]>();
  const topLevel: DomainEntity[] = [];
  for (const e of entities) {
    if (e.parentKey && keys.has(e.parentKey)) {
      const siblings = childrenByParent.get(e.parentKey);
      if (siblings) siblings.push(e);
      else childrenByParent.set(e.parentKey, [e]);
    } else {
      topLevel.push(e);
    }
  }
  for (const children of childrenByParent.values()) children.sort(byLabel);
  topLevel.sort(byLabel);

  return (
    <div>
      <SectionHeading color={def.color} label={def.label} count={entities.length} />
      {topLevel.map((parent) => {
        const children = childrenByParent.get(parent.key) ?? [];
        const expanded = children.length === 0 || isExpanded(parent.key);
        return (
          <div key={parent.key}>
            <EntityRow
              entity={parent}
              extraHighlightIds={children.map((c) => c.topicNodeIds)}
              color={def.color}
              indent={false}
              childCount={children.length}
              expanded={expanded}
              onToggle={children.length > 0 ? () => toggle(parent.key) : undefined}
            />
            {expanded &&
              children.map((child) => (
                <EntityRow key={child.key} entity={child} color={def.color} indent />
              ))}
          </div>
        );
      })}
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
  // Registry-backed ecosystems share the generic parent/child tree.
  const treeEcosystems: EcosystemId[] = ["homeassistant", "frigate", "shelly", "owntracks", "ttn", "chirpstack", "homie"];

  return (
    <div className="p-2 space-y-2">
      {sparkplug.length > 0 && <SparkplugSection entities={sparkplug} />}
      {treeEcosystems.map((id) => {
        const sectionEntities = entities.filter((e) => e.ecosystem === id);
        if (sectionEntities.length === 0) return null;
        return <EntityTreeSection key={id} ecosystemId={id} entities={sectionEntities} />;
      })}
    </div>
  );
}
