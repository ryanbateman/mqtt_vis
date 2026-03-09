/**
 * settingsStorage.ts
 *
 * Persists user-adjustable visual/label/simulation settings (and panel collapse
 * states) to localStorage so they survive page reloads.
 *
 * Storage key:  "mqtt_settings"
 * Format:       JSON object with a _version field for schema migration.
 *
 * Precedence (highest to lowest):
 *   localStorage  →  config.json  →  hardcoded fallback
 *
 * Connection parameters (brokerUrl, topicFilter, etc.) are persisted separately
 * under "mqtt_connection" by useMqttClient — this module does not touch them.
 */

import type { LabelMode } from "../types";

/** Increment when the stored schema changes to force a one-time reset. */
const STORAGE_VERSION = 1;
const STORAGE_KEY = "mqtt_settings";

/** All fields that are persisted. */
export interface SavedSettings {
  // Visual
  emaTau?: number;
  nodeScale?: number;
  scaleNodeSizeByDepth?: boolean;
  ancestorPulse?: boolean;
  showRootPath?: boolean;
  showTooltips?: boolean;
  // Labels
  showLabels?: boolean;
  labelDepthFactor?: number;
  labelMode?: LabelMode;
  labelFontSize?: number;
  labelStrokeWidth?: number;
  scaleTextByDepth?: boolean;
  // Simulation
  repulsionStrength?: number;
  linkDistance?: number;
  linkStrength?: number;
  collisionPadding?: number;
  alphaDecay?: number;
  pruneTimeout?: number;
  dropRetainedBurst?: boolean;
  burstWindowDuration?: number;
  // Data Insights
  showGeoIndicators?: boolean;
  // Panel UI state (ephemeral per-component, but nice to restore)
  settingsCollapsed?: boolean;
  connectionCollapsed?: boolean;
}

/** Internal stored shape — includes version sentinel. */
interface StoredSettings extends SavedSettings {
  _version: number;
}

// ---------------------------------------------------------------------------
// Per-field validators
// Each returns the value if valid, or undefined to fall through to the next
// layer of the precedence chain.
// ---------------------------------------------------------------------------

function validNumber(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== "number" || !isFinite(v)) return undefined;
  if (v < min || v > max) return undefined;
  return v;
}

function validBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function validLabelMode(v: unknown): LabelMode | undefined {
  return v === "zoom" || v === "depth" || v === "activity" ? v : undefined;
}

/**
 * Validate and sanitise every field individually.
 * A corrupt or out-of-range field falls through to config.json — we don't
 * discard the entire saved settings object over one bad value.
 */
function validate(raw: StoredSettings): SavedSettings {
  return {
    emaTau:             validNumber(raw.emaTau,             0.5,  30),
    nodeScale:          validNumber(raw.nodeScale,           0.5,   5),
    scaleNodeSizeByDepth: validBoolean(raw.scaleNodeSizeByDepth),
    ancestorPulse:      validBoolean(raw.ancestorPulse),
    showRootPath:       validBoolean(raw.showRootPath),
    showTooltips:       validBoolean(raw.showTooltips),
    showLabels:         validBoolean(raw.showLabels),
    labelDepthFactor:   validNumber(raw.labelDepthFactor,    1,   20),
    labelMode:          validLabelMode(raw.labelMode),
    labelFontSize:      validNumber(raw.labelFontSize,        6,   32),
    labelStrokeWidth:   validNumber(raw.labelStrokeWidth,    4.5, 13.5),
    scaleTextByDepth:   validBoolean(raw.scaleTextByDepth),
    repulsionStrength:  validNumber(raw.repulsionStrength,  -500, -20),
    linkDistance:       validNumber(raw.linkDistance,         20, 300),
    linkStrength:       validNumber(raw.linkStrength,        0.05,  1),
    collisionPadding:   validNumber(raw.collisionPadding,     0,   20),
    alphaDecay:         validNumber(raw.alphaDecay,         0.001, 0.05),
    pruneTimeout:       validNumber(raw.pruneTimeout,       0, 300_000),
    dropRetainedBurst: validBoolean(raw.dropRetainedBurst),
    burstWindowDuration: validNumber(raw.burstWindowDuration, 5_000, 30_000),
    showGeoIndicators:  validBoolean(raw.showGeoIndicators),
    settingsCollapsed:  validBoolean(raw.settingsCollapsed),
    connectionCollapsed: validBoolean(raw.connectionCollapsed),
  };
}

/**
 * Load saved settings from localStorage.
 * Returns a (possibly partial) SavedSettings object.
 * Returns {} on any error (missing key, corrupt JSON, wrong version).
 */
export function loadSavedSettings(): SavedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const stored = parsed as StoredSettings;
    if (stored._version !== STORAGE_VERSION) return {};
    return validate(stored);
  } catch {
    return {};
  }
}

/**
 * Persist a partial settings object to localStorage, merging with any
 * existing saved values.
 * Silently no-ops if localStorage is unavailable (private browsing, etc.).
 */
export function persistSettings(partial: SavedSettings): void {
  try {
    const existing = loadSavedSettings();
    const merged: StoredSettings = {
      _version: STORAGE_VERSION,
      ...existing,
      ...partial,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // localStorage unavailable — continue without persistence
  }
}

/**
 * Remove all saved settings from localStorage.
 * Called by resetSettings() so "Reset to Defaults" truly resets to
 * config.json / hardcoded defaults, not to previously saved values.
 */
export function clearSavedSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
