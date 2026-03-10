import type { Broker } from "../types";

/** All configurable fields. Every field is optional — omitted fields use hardcoded defaults. */
export interface AppConfig {
  // Connection
  topicFilter?: string;
  clientId?: string | null;
  username?: string;
  password?: string;
  autoconnect?: boolean;

  // Brokers for the quick-connect dropdown.
  // The first entry is used as the default on first load.
  brokers?: Broker[];

  // Appearance
  emaTau?: number;
  showLabels?: boolean;
  labelDepthFactor?: number;
  labelMode?: "zoom" | "depth" | "activity";
  labelFontSize?: number;
  labelStrokeWidth?: number;
  scaleTextByDepth?: boolean;
  showTooltips?: boolean;
  nodeScale?: number;
  scaleNodeSizeByDepth?: boolean;
  ancestorPulse?: boolean;
  showRootPath?: boolean;

  // Data Insights
  showGeoIndicators?: boolean;
  showImageIndicators?: boolean;

  // Simulation
  repulsionStrength?: number;
  linkDistance?: number;
  linkStrength?: number;
  collisionPadding?: number;
  alphaDecay?: number;
  pruneTimeout?: number;
  dropRetainedBurst?: boolean;
  burstWindowDuration?: number;

  // UI state
  settingsCollapsed?: boolean;
  connectionCollapsed?: boolean;

  // WebMCP integration
  webmcpEnabled?: boolean;

  // Branding
  /** Panel description shown below the title when expanded.
   *  Empty string "" hides it. Omitted / null uses the default. */
  description?: string | null;
}

let config: AppConfig = {};

/**
 * Fetch config.json from the server. Silently falls back to an empty
 * config (all hardcoded defaults) if the file is missing or malformed.
 * Must be called before React renders so getConfig() returns loaded values.
 */
export async function loadConfig(): Promise<void> {
  try {
    const resp = await fetch(import.meta.env.BASE_URL + "config.json");
    if (resp.ok) {
      config = await resp.json();
    }
  } catch {
    // Config file missing or invalid — use hardcoded defaults
  }
}

/** Get the loaded config (empty object if loadConfig hasn't run or failed). */
export function getConfig(): AppConfig {
  return config;
}
