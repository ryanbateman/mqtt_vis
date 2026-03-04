import type { PublicBroker } from "../types";

/** All configurable fields. Every field is optional — omitted fields use hardcoded defaults. */
export interface AppConfig {
  // Connection
  brokerUrl?: string;
  topicFilter?: string;
  clientId?: string | null;
  username?: string;
  password?: string;
  autoconnect?: boolean;

  // Public brokers (quick-connect dropdown)
  publicBrokers?: PublicBroker[];

  // Appearance
  emaTau?: number;
  showLabels?: boolean;
  labelDepthFactor?: number;
  labelMode?: "zoom" | "depth";
  labelFontSize?: number;
  scaleTextByDepth?: boolean;
  showTooltips?: boolean;
  nodeScale?: number;
  scaleNodeSizeByDepth?: boolean;
  ancestorPulse?: boolean;
  showRootPath?: boolean;

  // Simulation
  repulsionStrength?: number;
  linkDistance?: number;
  linkStrength?: number;
  collisionPadding?: number;
  alphaDecay?: number;

  // UI state
  settingsCollapsed?: boolean;
  connectionCollapsed?: boolean;
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
