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
  {
    id: "owntracks",
    label: "OwnTracks",
    // Matches the owntracks indicator-ring violet (tagRegistry.ts).
    color: "#a78bfa",
    topicFilter: "owntracks/#",
  },
  {
    id: "ttn",
    label: "The Things Network",
    // Matches the ttn indicator-ring indigo (tagRegistry.ts).
    color: "#6366f1",
    topicFilter: "v3/#",
  },
  {
    id: "chirpstack",
    label: "ChirpStack",
    // Matches the chirpstack indicator-ring pink (tagRegistry.ts).
    color: "#ec4899",
    // "application/" alone is generic; the +/device/ infix scopes the preset
    // to ChirpStack's device topics (payload shape confirms identity).
    topicFilter: "application/+/device/#",
  },
  {
    id: "homie",
    label: "Homie",
    // Matches the homie indicator-ring lime (tagRegistry.ts).
    color: "#a3e635",
    // The common base; detection is signature-based ($homie) at any base, so
    // custom-base devices (e.g. Valetudo) need a broader filter.
    topicFilter: "homie/#",
  },
];

/** Look up an ecosystem definition by id. Throws on unknown id (programming error). */
export function getEcosystemDefinition(id: EcosystemId): EcosystemDefinition {
  const def = ECOSYSTEM_REGISTRY.find((e) => e.id === id);
  if (!def) throw new Error(`Unknown ecosystem: ${id}`);
  return def;
}
