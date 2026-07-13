import type { DetectorResult, PayloadTagType } from "../types/payloadTags";

/**
 * Central registry of payload tag types (data insights).
 *
 * Every per-tag concern that the UI needs — label, ring colour, settings
 * wiring, Insights Drawer tab — lives here. Adding a new tag type means:
 *   1. Extend PayloadTagType + TagMetadataMap in types/payloadTags.ts.
 *   2. Write the detector and register it in payloadAnalyzer.worker.ts.
 *   3. Add a TagDefinition entry below (+ the optional settings boolean in
 *      settingsStorage.ts / config.ts).
 * Settings checkboxes, ring colours, and drawer tabs are generated from
 * this registry — no further UI wiring is required.
 */

/** Insights Drawer tab identifiers. Single source of truth. */
export type InsightsTab = "map" | "image" | "device";

/** Store/settings boolean keys that toggle a tag's indicator ring. */
export type IndicatorSettingsKey =
  | "showGeoIndicators"
  | "showImageIndicators"
  | "showSparkplugIndicators"
  | "showHomeAssistantIndicators"
  | "showFrigateIndicators"
  | "showShellyIndicators"
  | "showOwnTracksIndicators"
  | "showTtnIndicators"
  | "showChirpstackIndicators"
  | "showHomieIndicators"
  | "showOpenDtuIndicators"
  | "showTasmotaIndicators"
  | "showWledIndicators";

/** Static definition of one payload tag type. */
export interface TagDefinition {
  /** Tag identifier — matches DetectorResult.tag. */
  id: PayloadTagType;
  /** Short human label, e.g. "Geo". */
  label: string;
  /** Insight ring colour (hex). */
  ringColor: string;
  /** Boolean settings/store field that enables this tag's ring. */
  settingsKey: IndicatorSettingsKey;
  /** Label for the settings checkbox. */
  settingsLabel: string;
  /** Tooltip for the settings checkbox. */
  settingsTooltip: string;
  /** Default enabled state when no saved/config value exists. */
  defaultEnabled: boolean;
  /** Insights Drawer tab that displays this tag's data, if any. */
  drawerTab: InsightsTab | null;
}

/** All known payload tags, in display/ring order. */
export const TAG_REGISTRY: readonly TagDefinition[] = [
  {
    id: "geo",
    label: "Geo",
    ringColor: "#00ffff",
    settingsKey: "showGeoIndicators",
    settingsLabel: "Geo Indicators",
    settingsTooltip:
      "Show a coloured ring around nodes whose payload contains geographic coordinates (lat/lon)",
    defaultEnabled: true,
    drawerTab: "map",
  },
  {
    id: "image",
    label: "Image",
    ringColor: "#a855f7",
    settingsKey: "showImageIndicators",
    settingsLabel: "Image Indicators",
    settingsTooltip:
      "Show a coloured ring around nodes whose payload contains image data (JPEG, PNG)",
    defaultEnabled: true,
    drawerTab: "image",
  },
  {
    id: "sparkplug",
    label: "Sparkplug",
    // Emerald — deliberately outside the node heat palette (slate/sky/orange/
    // amber/yellow) and distinct from geo cyan and image purple.
    ringColor: "#34d399",
    settingsKey: "showSparkplugIndicators",
    settingsLabel: "Sparkplug Indicators",
    settingsTooltip:
      "Show a coloured ring around Sparkplug B edge nodes and devices (offline entities get a dashed red ring)",
    defaultEnabled: true,
    drawerTab: "device",
  },
  {
    id: "homeassistant",
    label: "Home Assistant",
    // HA brand blue — distinct from geo cyan and the node heat palette.
    ringColor: "#41bdf5",
    settingsKey: "showHomeAssistantIndicators",
    settingsLabel: "Home Assistant Indicators",
    settingsTooltip:
      "Show a coloured ring around topics belonging to Home Assistant discovery entities (config and state topics)",
    defaultEnabled: true,
    drawerTab: null,
  },
  {
    id: "frigate",
    label: "Frigate",
    // Orange — distinct from the heat palette's amber band at ring width.
    ringColor: "#fb923c",
    settingsKey: "showFrigateIndicators",
    settingsLabel: "Frigate Indicators",
    settingsTooltip:
      "Show a coloured ring around topics belonging to Frigate NVR cameras",
    defaultEnabled: true,
    drawerTab: null,
  },
  {
    id: "shelly",
    label: "Shelly",
    // Teal — distinct from geo cyan and Home Assistant blue.
    ringColor: "#2dd4bf",
    settingsKey: "showShellyIndicators",
    settingsLabel: "Shelly Indicators",
    settingsTooltip:
      "Show a coloured ring around topics belonging to Shelly devices (Gen1 announce-based)",
    defaultEnabled: true,
    drawerTab: null,
  },
  {
    id: "owntracks",
    label: "OwnTracks",
    // Violet — distinct from geo cyan (which the same topics also carry).
    ringColor: "#a78bfa",
    settingsKey: "showOwnTracksIndicators",
    settingsLabel: "OwnTracks Indicators",
    settingsTooltip:
      "Show a coloured ring around topics belonging to OwnTracks location trackers",
    defaultEnabled: true,
    drawerTab: null,
  },
  {
    id: "ttn",
    label: "The Things Network",
    // Indigo — distinct from Home Assistant blue and the heat palette.
    ringColor: "#6366f1",
    settingsKey: "showTtnIndicators",
    settingsLabel: "The Things Network Indicators",
    settingsTooltip:
      "Show a coloured ring around topics belonging to The Things Network (LoRaWAN) applications and devices",
    defaultEnabled: true,
    drawerTab: null,
  },
  {
    id: "chirpstack",
    label: "ChirpStack",
    // Pink — distinct from every other ring and the offline dashed red.
    ringColor: "#ec4899",
    settingsKey: "showChirpstackIndicators",
    settingsLabel: "ChirpStack Indicators",
    settingsTooltip:
      "Show a coloured ring around topics belonging to ChirpStack (LoRaWAN) applications and devices",
    defaultEnabled: true,
    drawerTab: null,
  },
  {
    id: "homie",
    label: "Homie",
    // Lime — distinct from Sparkplug emerald and the rest of the palette.
    ringColor: "#a3e635",
    settingsKey: "showHomieIndicators",
    settingsLabel: "Homie Indicators",
    settingsTooltip:
      "Show a coloured ring around topics belonging to Homie-convention devices, nodes, and properties",
    defaultEnabled: true,
    drawerTab: null,
  },
  {
    id: "opendtu",
    label: "OpenDTU",
    // Rose — distinct from every other ring and outside the node heat palette.
    ringColor: "#fb7185",
    settingsKey: "showOpenDtuIndicators",
    settingsLabel: "OpenDTU Indicators",
    settingsTooltip:
      "Show a coloured ring around topics belonging to OpenDTU gateways and Hoymiles inverters",
    defaultEnabled: true,
    drawerTab: null,
  },
  {
    id: "tasmota",
    label: "Tasmota",
    // Amber — distinct from every other ecosystem colour.
    ringColor: "#f59e0b",
    settingsKey: "showTasmotaIndicators",
    settingsLabel: "Tasmota Indicators",
    settingsTooltip:
      "Show a coloured ring around topics belonging to Tasmota devices (tele/stat/cmnd)",
    defaultEnabled: true,
    drawerTab: null,
  },
  {
    id: "wled",
    label: "WLED",
    // Fuchsia — outside the node heat palette (slate/sky/orange/amber/yellow)
    // and sits between image purple and chirpstack pink with room to spare.
    ringColor: "#d946ef",
    settingsKey: "showWledIndicators",
    settingsLabel: "WLED Indicators",
    settingsTooltip:
      "Show a coloured ring around topics belonging to WLED light controllers",
    defaultEnabled: true,
    drawerTab: null,
  },
];

/** Look up a tag definition by id. Throws on unknown id (programming error). */
export function getTagDefinition(id: PayloadTagType): TagDefinition {
  const def = TAG_REGISTRY.find((t) => t.id === id);
  if (!def) throw new Error(`Unknown payload tag type: ${id}`);
  return def;
}

/**
 * Find the first detection of a given tag type, with metadata narrowed to
 * that tag's metadata shape.
 */
export function getTag<T extends PayloadTagType>(
  tags: readonly DetectorResult[] | null | undefined,
  type: T,
): DetectorResult<T> | undefined {
  return tags?.find((t) => t.tag === type) as DetectorResult<T> | undefined;
}
