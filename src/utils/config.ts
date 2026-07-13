import type { Broker } from "../types";

/** All configurable fields. Every field is optional — omitted fields use hardcoded defaults. */
export interface AppConfig {
  // Connection
  topicFilter?: string;
  clientId?: string | null;
  username?: string;
  password?: string;
  /** MQTT keep-alive interval in seconds. Deployment default for the connection form. */
  keepalive?: number;
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
  clearOnDisconnect?: boolean;
  nodeScale?: number;
  scaleNodeSizeByDepth?: boolean;
  ancestorPulse?: boolean;
  showRootPath?: boolean;

  // Data Insights
  showGeoIndicators?: boolean;
  showImageIndicators?: boolean;
  showSparkplugIndicators?: boolean;
  showHomeAssistantIndicators?: boolean;
  showFrigateIndicators?: boolean;
  showShellyIndicators?: boolean;
  showOwnTracksIndicators?: boolean;
  showTtnIndicators?: boolean;
  showChirpstackIndicators?: boolean;
  showHomieIndicators?: boolean;
  showOpenDtuIndicators?: boolean;
  showTasmotaIndicators?: boolean;
  fadeIndicatorRings?: boolean;
  followEcosystemTopics?: boolean;

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

  // Auto-tour mode
  /** "autotour" strips all chrome (click still opens a floating detail drawer) and
   *  runs an auto-tour of active topics. Default "normal". */
  displayMode?: "normal" | "autotour";
  /** Auto-tour: ms an entity panel (map/image/device) is shown before flipping to payload. */
  autoTourEntityDwellMs?: number;
  /** Auto-tour: ms the payload tab is shown after the entity phase (entity nodes). */
  autoTourPayloadDwellMs?: number;
  /** Auto-tour: total ms an entity-less node is shown (payload only, shorter). */
  autoTourPlainDwellMs?: number;
  /** Auto-tour: ms gap between picks (graph-only). */
  autoTourIntervalMs?: number;
  /** Auto-tour: insert a longer graph-only rest after this many highlights. */
  autoTourRestEvery?: number;
  /** Auto-tour: length (ms) of the graph-only rest period. */
  autoTourRestMs?: number;
  /** Auto-tour: auto-shake the layout after this many highlights. */
  autoTourShakeEvery?: number;

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

/** Resolved auto-tour timings (ms / counts), config values with defaults applied. */
export interface AutoTourTiming {
  entityDwellMs: number;
  payloadDwellMs: number;
  plainDwellMs: number;
  intervalMs: number;
  restEvery: number;
  restMs: number;
  shakeEvery: number;
}

/** Read the auto-tour timings from config, falling back to sensible defaults. */
export function getAutoTourTiming(): AutoTourTiming {
  const c = config;
  return {
    entityDwellMs: c.autoTourEntityDwellMs ?? 8000,
    payloadDwellMs: c.autoTourPayloadDwellMs ?? 5000,
    plainDwellMs: c.autoTourPlainDwellMs ?? 5000,
    intervalMs: c.autoTourIntervalMs ?? 12000,
    restEvery: c.autoTourRestEvery ?? 3,
    restMs: c.autoTourRestMs ?? 36000,
    shakeEvery: c.autoTourShakeEvery ?? 5,
  };
}
