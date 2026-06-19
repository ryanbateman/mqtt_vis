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

  // Embed / kiosk mode
  /** Strip the UI down to the bare graph. "embed" hides all chrome (click still
   *  opens a floating detail drawer); "kiosk" adds an auto-tour. Default "normal". */
  displayMode?: "normal" | "embed" | "kiosk";
  /** @deprecated Legacy alias for `displayMode: "embed"`. */
  embed?: boolean;
  /** Kiosk auto-tour: ms an entity panel (map/image/device) is shown before flipping to payload. */
  kioskEntityDwellMs?: number;
  /** Kiosk auto-tour: ms the payload tab is shown after the entity phase (entity nodes). */
  kioskPayloadDwellMs?: number;
  /** Kiosk auto-tour: total ms an entity-less node is shown (payload only, shorter). */
  kioskPlainDwellMs?: number;
  /** Kiosk auto-tour: ms gap between picks (graph-only). */
  kioskIntervalMs?: number;
  /** Kiosk auto-tour: insert a longer graph-only rest after this many highlights. */
  kioskRestEvery?: number;
  /** Kiosk auto-tour: length (ms) of the graph-only rest period. */
  kioskRestMs?: number;
  /** Kiosk auto-tour: auto-shake the layout after this many highlights. */
  kioskShakeEvery?: number;

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

/** Resolved kiosk auto-tour timings (ms / counts), config values with defaults applied. */
export interface KioskTiming {
  entityDwellMs: number;
  payloadDwellMs: number;
  plainDwellMs: number;
  intervalMs: number;
  restEvery: number;
  restMs: number;
  shakeEvery: number;
}

/** Read the kiosk auto-tour timings from config, falling back to sensible defaults. */
export function getKioskTiming(): KioskTiming {
  const c = config;
  return {
    entityDwellMs: c.kioskEntityDwellMs ?? 8000,
    payloadDwellMs: c.kioskPayloadDwellMs ?? 5000,
    plainDwellMs: c.kioskPlainDwellMs ?? 5000,
    intervalMs: c.kioskIntervalMs ?? 12000,
    restEvery: c.kioskRestEvery ?? 3,
    restMs: c.kioskRestMs ?? 36000,
    shakeEvery: c.kioskShakeEvery ?? 5,
  };
}
