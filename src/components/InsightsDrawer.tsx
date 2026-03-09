import { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTopicStore } from "../stores/topicStore";
import { findNode } from "../utils/topicParser";
import { formatTimestamp } from "../utils/formatters";
import type { GeoMetadata, TrailPoint } from "../types/payloadTags";

/** Maximum number of trail points before oldest are discarded. */
const MAX_TRAIL_POINTS = 50;

/** Style constants for trail rendering. */
const TRAIL_DOT_RADIUS = 4;
const TRAIL_DOT_COLOR = "#00ffff";
const TRAIL_DOT_OPACITY = 0.4;
const TRAIL_LINE_COLOR = "#ef4444";
const TRAIL_LINE_OPACITY = 0.7;
const TRAIL_LINE_WEIGHT = 2;

/**
 * Custom circle marker icon — avoids the well-known Leaflet/bundler issue
 * where default marker PNGs fail to load.  A cyan circle on dark background
 * matches the app's insight ring colour and dark theme.
 */
const geoMarkerIcon = L.divIcon({
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

/**
 * Extract the first geo detection result from a topic node looked up by path.
 * Returns null if the node doesn't exist or has no geo tag.
 */
function getGeoForTopic(topicPath: string): GeoMetadata | null {
  const root = useTopicStore.getState().root;
  const segments = topicPath === "" ? [] : topicPath.split("/");
  const node = findNode(root, segments);
  const tag = node?.payloadTags?.find((t) => t.tag === "geo");
  return tag ? (tag.metadata as GeoMetadata) : null;
}

/**
 * Slide-out drawer displaying rich insights for a selected node.
 * Supports geo coordinate display via a Leaflet map with a historical
 * position trail that builds as new payloads arrive.
 *
 * React owns the container elements; Leaflet manages the map inside a ref
 * (same pattern as D3 in GraphRenderer).
 */
export function InsightsDrawer({
  topicPath,
  geo,
  onClose,
}: {
  /** Full topic path of the selected node. */
  topicPath: string;
  /** Detected geo coordinates to display on the map (initial snapshot). */
  geo: GeoMetadata;
  /** Called when the drawer is closed. */
  onClose: () => void;
}) {
  // --- Refs for Leaflet objects (managed outside React's render cycle) ------
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const trailMarkersRef = useRef<L.CircleMarker[]>([]);
  const trailRef = useRef<TrailPoint[]>([]);
  const prevGeoRef = useRef<{ lat: number; lon: number } | null>(null);
  // Ref for the live coordinates displayed in the header
  const liveGeoRef = useRef<{ lat: number; lon: number }>({ lat: geo.lat, lon: geo.lon });

  // --- Subscribe to store for live geo updates on this topic ---------------
  // We use a Zustand subscription rather than a selector to avoid React
  // re-renders on every store tick. The Leaflet map is imperative — we
  // update it directly from the subscription callback.

  /** Clear all trail markers, polyline, and reset the trail array. */
  const clearTrail = useCallback(() => {
    const map = mapRef.current;
    if (map) {
      for (const m of trailMarkersRef.current) {
        map.removeLayer(m);
      }
      if (polylineRef.current) {
        map.removeLayer(polylineRef.current);
        polylineRef.current = null;
      }
    }
    trailMarkersRef.current = [];
    trailRef.current = [];
  }, []);

  /** Add a trail dot for a previous position and update the polyline. */
  const addTrailPoint = useCallback((point: TrailPoint) => {
    const map = mapRef.current;
    if (!map) return;

    const trail = trailRef.current;

    // Enforce cap — remove oldest dot if at limit
    if (trail.length >= MAX_TRAIL_POINTS) {
      const oldest = trailMarkersRef.current.shift();
      if (oldest) map.removeLayer(oldest);
      trail.shift();
    }

    trail.push(point);

    // Create trail dot
    const dot = L.circleMarker([point.lat, point.lon], {
      radius: TRAIL_DOT_RADIUS,
      fillColor: TRAIL_DOT_COLOR,
      fillOpacity: TRAIL_DOT_OPACITY,
      stroke: false,
    }).addTo(map);

    dot.bindTooltip(formatTimestamp(point.timestamp), {
      direction: "top",
      offset: [0, -6],
      className: "trail-tooltip",
    });

    trailMarkersRef.current.push(dot);

    // Update polyline to connect all trail points + current marker position
    updatePolyline();
  }, []);

  /** Rebuild the polyline from trail points + current marker position. */
  const updatePolyline = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const points: L.LatLngExpression[] = trailRef.current.map((p) => [p.lat, p.lon]);
    // Append the current (live) marker position
    if (markerRef.current) {
      const pos = markerRef.current.getLatLng();
      points.push([pos.lat, pos.lng]);
    }

    if (polylineRef.current) {
      polylineRef.current.setLatLngs(points);
    } else if (points.length >= 2) {
      polylineRef.current = L.polyline(points, {
        color: TRAIL_LINE_COLOR,
        opacity: TRAIL_LINE_OPACITY,
        weight: TRAIL_LINE_WEIGHT,
        smoothFactor: 1,
      }).addTo(map);
    }
  }, []);

  // --- Initialize Leaflet map on mount -------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return; // already initialized

    const map = L.map(mapContainerRef.current, {
      center: [geo.lat, geo.lon],
      zoom: 13,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker([geo.lat, geo.lon], { icon: geoMarkerIcon }).addTo(map);
    markerRef.current = marker;
    mapRef.current = map;
    prevGeoRef.current = { lat: geo.lat, lon: geo.lon };

    // Leaflet needs a resize kick after the container transitions in
    const resizeTimer = setTimeout(() => {
      map.invalidateSize();
    }, 350);

    return () => {
      clearTimeout(resizeTimer);
    };
    // Only run on mount — geo updates are handled by the store subscription
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Handle topic path changes (node switch while drawer stays open) -----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Reset trail for the new topic
    clearTrail();
    prevGeoRef.current = { lat: geo.lat, lon: geo.lon };
    liveGeoRef.current = { lat: geo.lat, lon: geo.lon };

    // Move marker and view to new position
    if (markerRef.current) {
      markerRef.current.setLatLng([geo.lat, geo.lon]);
    }
    map.setView([geo.lat, geo.lon], map.getZoom());
  }, [topicPath, geo.lat, geo.lon, clearTrail]);

  // --- Store subscription for live geo updates -----------------------------
  useEffect(() => {
    const unsubscribe = useTopicStore.subscribe(() => {
      const liveGeo = getGeoForTopic(topicPath);
      if (!liveGeo) return;

      const prev = prevGeoRef.current;
      if (prev && prev.lat === liveGeo.lat && prev.lon === liveGeo.lon) return;

      const map = mapRef.current;
      if (!map) return;

      // Position changed — push previous position to trail
      if (prev) {
        addTrailPoint({ lat: prev.lat, lon: prev.lon, timestamp: Date.now() });
      }

      // Update current marker
      if (markerRef.current) {
        markerRef.current.setLatLng([liveGeo.lat, liveGeo.lon]);
      }
      updatePolyline();

      // Smoothly pan to new position
      map.flyTo([liveGeo.lat, liveGeo.lon], map.getZoom(), {
        duration: 0.5,
      });

      prevGeoRef.current = { lat: liveGeo.lat, lon: liveGeo.lon };
      liveGeoRef.current = { lat: liveGeo.lat, lon: liveGeo.lon };

      // Force a re-render so the coordinates display updates
      // We do this by updating a state... but we're using refs to avoid
      // unnecessary re-renders. Instead, update the DOM directly.
      const latEl = document.getElementById("insights-live-lat");
      const lonEl = document.getElementById("insights-live-lon");
      if (latEl) latEl.textContent = String(liveGeo.lat);
      if (lonEl) lonEl.textContent = String(liveGeo.lon);
    });

    return unsubscribe;
  }, [topicPath, addTrailPoint, updatePolyline]);

  // --- Clean up map on unmount ---------------------------------------------
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
        polylineRef.current = null;
        trailMarkersRef.current = [];
        trailRef.current = [];
      }
    };
  }, []);

  // --- Close on Escape -----------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="absolute bottom-4 right-4 z-20 w-96 max-h-[calc(100vh-2rem)] flex flex-col bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg shadow-xl overflow-hidden animate-slide-up">
      {/* Header */}
      <div className="flex items-start gap-2 p-3 pb-2 border-b border-gray-700/50 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
            Location
          </div>
          <div className="text-xs font-mono text-gray-100 break-all leading-snug">
            {topicPath}
          </div>
        </div>
        <button
          onClick={onClose}
          title="Close (Esc)"
          className="flex-shrink-0 p-0.5 text-gray-500 hover:text-gray-200 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Coordinates */}
      <div className="px-3 py-2 border-b border-gray-700/50 flex-shrink-0">
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          <span className="text-gray-500">Latitude</span>
          <span id="insights-live-lat" className="text-gray-300 font-mono">{geo.lat}</span>
          <span className="text-gray-500">Longitude</span>
          <span id="insights-live-lon" className="text-gray-300 font-mono">{geo.lon}</span>
          <span className="text-gray-500">Source</span>
          <span className="text-gray-300 font-mono text-[10px]">
            {geo.latPath} / {geo.lonPath}
          </span>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 min-h-0">
        <div
          ref={mapContainerRef}
          className="w-full h-72"
          style={{ background: "#1e293b" }}
        />
      </div>
    </div>
  );
}
