import type { TrailPoint } from "../types/payloadTags";

/**
 * Module-level cache for the global map panel.
 *
 * The side rail unmounts an inactive section's content, which destroys the
 * Leaflet instance and every layer on it. Leaflet layers cannot be reattached
 * to a new map, so this cache holds only plain data — the viewport and the
 * accumulated trail points — from which layers are rebuilt on remount. Without
 * it the user's pan/zoom would reset on every tab switch.
 */

/** Recorded positions for one topic, plus the last position seen. */
export interface CachedTrail {
  trail: TrailPoint[];
  prevPos: { lat: number; lon: number; timestamp?: number };
}

export interface GeoMapCache {
  /** Last viewport, or null when the map has never been opened. */
  view: { center: [number, number]; zoom: number } | null;
  /** Trail history keyed by topic path. */
  trails: Map<string, CachedTrail>;
}

export const geoMapCache: GeoMapCache = {
  view: null,
  trails: new Map(),
};

/** Drop cached view and trails — the topic tree is about to be cleared. */
export function clearGeoMapCache(): void {
  geoMapCache.view = null;
  geoMapCache.trails.clear();
}
