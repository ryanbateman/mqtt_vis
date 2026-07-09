import L from "leaflet";

/**
 * Shared Leaflet styling for the two geo surfaces: the per-topic map in the
 * Topic drawer and the global map panel. Kept here so both draw identical
 * markers and trails.
 */

/** Maximum number of trail points per topic before oldest are discarded. */
export const MAX_TRAIL_POINTS = 50;

/** Style constants for trail rendering. */
export const TRAIL_DOT_RADIUS = 4;
export const TRAIL_DOT_COLOR = "#00ffff";
export const TRAIL_DOT_OPACITY = 0.4;
export const TRAIL_LINE_COLOR = "#ef4444";
export const TRAIL_LINE_OPACITY = 0.7;
export const TRAIL_LINE_WEIGHT = 2;

/**
 * Custom circle marker icon — avoids the well-known Leaflet/bundler issue
 * where default marker PNGs fail to load.  A cyan circle on dark background
 * matches the app's insight ring colour and dark theme.
 */
export const geoMarkerIcon = L.divIcon({
  className: "",
  html: `<div style="
    width: 16px; height: 16px;
    background: #00ffff;
    border: 2px solid #0e7490;
    border-radius: 50%;
    box-shadow: 0 0 8px rgba(0,255,255,0.5);
  "></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/** OpenStreetMap raster tiles, shared by both map surfaces. */
export const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
export const TILE_MAX_ZOOM = 19;
