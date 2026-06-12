import type { EcosystemId } from "../types/entities";

/**
 * Central registry of known MQTT ecosystems (mirrors tagRegistry.ts).
 *
 * Per-ecosystem UI concerns — label, accent colour — live here so the
 * Ecosystems panel (and later: node badges, legend, topic filter presets)
 * need no per-ecosystem wiring. Adding an ecosystem means writing its
 * provider/facade under utils/ecosystems/ and adding an entry below.
 */
export interface EcosystemDefinition {
  id: EcosystemId;
  /** Short human label, e.g. "Sparkplug B". */
  label: string;
  /** Accent colour (hex): panel headings and graph highlight sets. */
  color: string;
  /** Subscription filter that surfaces this ecosystem (Topic Filter preset). */
  topicFilter: string;
}

/** All known ecosystems, in display order. */
export const ECOSYSTEM_REGISTRY: readonly EcosystemDefinition[] = [
  {
    id: "sparkplug",
    label: "Sparkplug B",
    // Matches the sparkplug indicator-ring emerald (tagRegistry.ts).
    color: "#34d399",
    topicFilter: "spBv1.0/#",
  },
  {
    id: "homeassistant",
    label: "Home Assistant",
    // Matches the homeassistant indicator-ring blue (tagRegistry.ts).
    color: "#41bdf5",
    // Discovery configs only — entities populate, but live state topics
    // usually live in other namespaces (zigbee2mqtt/...). Broadening to #
    // is the user's call via the Custom option.
    topicFilter: "homeassistant/#",
  },
  {
    id: "frigate",
    label: "Frigate",
    // Matches the frigate indicator-ring orange (tagRegistry.ts).
    color: "#fb923c",
    topicFilter: "frigate/#",
  },
  {
    id: "shelly",
    label: "Shelly",
    // Matches the shelly indicator-ring teal (tagRegistry.ts).
    color: "#2dd4bf",
    topicFilter: "shellies/#",
  },
];

/** Look up an ecosystem definition by id. Throws on unknown id (programming error). */
export function getEcosystemDefinition(id: EcosystemId): EcosystemDefinition {
  const def = ECOSYSTEM_REGISTRY.find((e) => e.id === id);
  if (!def) throw new Error(`Unknown ecosystem: ${id}`);
  return def;
}
