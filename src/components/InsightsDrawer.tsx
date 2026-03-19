import { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTopicStore } from "../stores/topicStore";
import { findNode } from "../utils/topicParser";
import { formatTimestamp } from "../utils/formatters";
import type { GeoMetadata, GeoNode, TrailPoint } from "../types/payloadTags";

/** Which content tab is active in the Insights Drawer. */
export type InsightsTab = "map" | "image";

/** Maximum number of trail points per topic before oldest are discarded. */
const MAX_TRAIL_POINTS = 50;

/** Style constants for trail rendering. */
const TRAIL_DOT_RADIUS = 4;
const TRAIL_DOT_COLOR = "#00ffff";
const TRAIL_DOT_OPACITY = 0.4;
const TRAIL_LINE_COLOR = "#ef4444";
const TRAIL_LINE_OPACITY = 0.7;
const TRAIL_LINE_WEIGHT = 2;

/** Per-topic trail state used in all-geo mode. */
interface TopicTrailState {
  trail: TrailPoint[];
  dots: L.CircleMarker[];
  polyline: L.Polyline | null;
  prevPos: { lat: number; lon: number };
}

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

/** Highlighted marker icon for the currently navigated node in all-geo mode. */
const geoMarkerIconHighlight = L.divIcon({
  className: "",
  html: `<div style="
    width: 22px; height: 22px;
    background: #fbbf24;
    border: 2px solid #d97706;
    border-radius: 50%;
    box-shadow: 0 0 12px rgba(251,191,36,0.6);
  "></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
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
 * Supports content tabs (Map and Image) and two geo modes:
 * - **single**: One topic's geo coordinates + historical trail.
 * - **all**: All detected geo topics shown as pins on a single map.
 *
 * React owns the container elements; Leaflet manages the map inside a ref
 * (same pattern as D3 in GraphRenderer).
 */
export function InsightsDrawer({
  topicPath,
  geo,
  imageBlobUrl,
  activeTab,
  onSetTab,
  isPinned,
  onTogglePin,
  mode,
  onSetMode,
  geoNodes,
  geoNavIndex,
  onNavigate,
  onClose,
}: {
  /** Full topic path of the selected node. */
  topicPath: string;
  /** Detected geo coordinates to display on the map (null if no geo data). */
  geo: GeoMetadata | null;
  /** Blob URL for an image payload preview (null if no image). */
  imageBlobUrl: string | null;
  /** Which content tab is currently active. */
  activeTab: InsightsTab;
  /** Switch the active content tab. */
  onSetTab: (tab: InsightsTab) => void;
  /** Whether the drawer is pinned (stays open across node selection changes). */
  isPinned: boolean;
  /** Toggle the pinned state. */
  onTogglePin: () => void;
  /** Current display mode: single topic or all geo nodes. */
  mode: "single" | "all";
  /** Switch display mode. */
  onSetMode: (mode: "single" | "all") => void;
  /** All currently detected geo-tagged topics. */
  geoNodes: GeoNode[];
  /** Index of the currently navigated geo node in geoNodes. */
  geoNavIndex: number;
  /** Navigate to a different geo node by index. */
  onNavigate: (index: number) => void;
  /** Called when the drawer is closed. */
  onClose: () => void;
}) {
  // --- Refs for Leaflet objects (managed outside React's render cycle) ------
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  // Single-mode refs
  const markerRef = useRef<L.Marker | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const trailMarkersRef = useRef<L.CircleMarker[]>([]);
  const trailRef = useRef<TrailPoint[]>([]);
  const prevGeoRef = useRef<{ lat: number; lon: number } | null>(null);

  // All-mode refs
  const allMarkersRef = useRef<L.Marker[]>([]);
  /** Markers indexed by topic path for reliable lookup in all-geo mode. */
  const allMarkersByTopicRef = useRef<Map<string, L.Marker>>(new Map());
  /** Per-topic trail state for all-geo mode (keyed by topic path). */
  const allTrailsRef = useRef<Map<string, TopicTrailState>>(new Map());

  // Track current mode in a ref so the store subscription can read it
  // without being re-created on every mode change.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // --- Trail helpers (single-mode only) ------------------------------------

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

    updatePolyline();
  }, []);

  /** Rebuild the polyline from trail points + current marker position. */
  const updatePolyline = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const points: L.LatLngExpression[] = trailRef.current.map((p) => [p.lat, p.lon]);
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

  // --- All-mode marker helpers ---------------------------------------------

  /** Remove all markers and trails added in all-geo mode. */
  const clearAllMarkers = useCallback(() => {
    const map = mapRef.current;
    if (map) {
      for (const m of allMarkersRef.current) {
        map.removeLayer(m);
      }
      // Clean up all per-topic trails
      for (const ts of allTrailsRef.current.values()) {
        for (const dot of ts.dots) map.removeLayer(dot);
        if (ts.polyline) map.removeLayer(ts.polyline);
      }
    }
    allMarkersRef.current = [];
    allMarkersByTopicRef.current.clear();
    allTrailsRef.current.clear();
  }, []);

  /** Add markers for all geo nodes, initialise per-topic trail state, and fit bounds.
   *  Preserves existing trail data for topics that were already being tracked. */
  const showAllMarkers = useCallback((nodes: GeoNode[], highlightIndex: number) => {
    const map = mapRef.current;
    if (!map || nodes.length === 0) return;

    // Save existing trail state before clearing markers
    const savedTrails = new Map(allTrailsRef.current);

    clearAllMarkers();

    const bounds = L.latLngBounds([]);

    nodes.forEach((node, idx) => {
      const isHighlighted = idx === highlightIndex;
      const marker = L.marker([node.geo.lat, node.geo.lon], {
        icon: isHighlighted ? geoMarkerIconHighlight : geoMarkerIcon,
        zIndexOffset: isHighlighted ? 1000 : 0,
      }).addTo(map);

      marker.bindTooltip(node.topicPath, {
        direction: "top",
        offset: [0, -10],
        className: "trail-tooltip",
      });

      // Click marker → switch to single-topic mode for that topic
      marker.on("click", () => {
        onNavigate(idx);
        onSetMode("single");
      });

      allMarkersRef.current.push(marker);
      allMarkersByTopicRef.current.set(node.topicPath, marker);
      bounds.extend([node.geo.lat, node.geo.lon]);

      // Restore or initialise per-topic trail tracking
      const existing = savedTrails.get(node.topicPath);
      if (existing) {
        // Re-add existing trail dots and polyline to the map
        for (const dot of existing.dots) dot.addTo(map);
        if (existing.polyline) existing.polyline.addTo(map);
        allTrailsRef.current.set(node.topicPath, existing);
      } else {
        allTrailsRef.current.set(node.topicPath, {
          trail: [],
          dots: [],
          polyline: null,
          prevPos: { lat: node.geo.lat, lon: node.geo.lon },
        });
      }
    });

    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
  }, [clearAllMarkers, onNavigate, onSetMode]);

  /** Update which marker is highlighted in all-geo mode (without rebuilding all). */
  const updateHighlight = useCallback((nodes: GeoNode[], highlightIndex: number) => {
    allMarkersRef.current.forEach((marker, idx) => {
      if (idx >= nodes.length) return;
      const isHighlighted = idx === highlightIndex;
      marker.setIcon(isHighlighted ? geoMarkerIconHighlight : geoMarkerIcon);
      marker.setZIndexOffset(isHighlighted ? 1000 : 0);
    });
  }, []);

  // --- Single-mode: remove single marker -----------------------------------
  const clearSingleMarker = useCallback(() => {
    const map = mapRef.current;
    if (map && markerRef.current) {
      map.removeLayer(markerRef.current);
      markerRef.current = null;
    }
  }, []);

  // --- Initialize Leaflet map on mount (only when geo data is available) ----
  useEffect(() => {
    if (!geo) return; // no geo data — skip map init
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

    mapRef.current = map;

    // Set up initial state based on mode
    if (mode === "single") {
      const marker = L.marker([geo.lat, geo.lon], { icon: geoMarkerIcon }).addTo(map);
      markerRef.current = marker;
      prevGeoRef.current = { lat: geo.lat, lon: geo.lon };
    } else {
      showAllMarkers(geoNodes, geoNavIndex);
    }

    // Leaflet needs a resize kick after the container transitions in
    const resizeTimer = setTimeout(() => {
      map.invalidateSize();
    }, 350);

    return () => {
      clearTimeout(resizeTimer);
    };
    // Only run on mount (or when geo first becomes available)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo !== null]);

  // --- Handle mode changes -------------------------------------------------
  useEffect(() => {
    if (!geo) return; // no geo data — mode changes are irrelevant
    const map = mapRef.current;
    if (!map) return;

    if (mode === "all") {
      // Transition to all-geo mode: transfer single-mode trail, then show all markers

      // Transfer single-mode trail to the all-trails map before clearing
      if (trailRef.current.length > 0 && topicPath) {
        const transferredState: TopicTrailState = {
          trail: [...trailRef.current],
          dots: [...trailMarkersRef.current],
          polyline: polylineRef.current,
          prevPos: prevGeoRef.current
            ? { ...prevGeoRef.current }
            : { lat: geo.lat, lon: geo.lon },
        };
        allTrailsRef.current.set(topicPath, transferredState);
        // Null out single-mode refs without removing from map (transferred to all-mode)
        trailMarkersRef.current = [];
        polylineRef.current = null;
        trailRef.current = [];
      }

      clearSingleMarker();
      showAllMarkers(geoNodes, geoNavIndex);
      prevGeoTopicsRef.current = geoNodes.map((n) => n.topicPath).join("\0");
    } else {
      // Transition to single-topic mode: clear all markers + trails, add single marker
      clearAllMarkers();
      prevGeoRef.current = { lat: geo.lat, lon: geo.lon };
      prevGeoTopicsRef.current = "";

      if (!markerRef.current) {
        const marker = L.marker([geo.lat, geo.lon], { icon: geoMarkerIcon }).addTo(map);
        markerRef.current = marker;
      } else {
        markerRef.current.setLatLng([geo.lat, geo.lon]);
      }
      map.setView([geo.lat, geo.lon], 13);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // --- Handle topic path changes in single mode ----------------------------
  useEffect(() => {
    if (mode !== "single") return;
    if (!geo) return; // no geo data
    const map = mapRef.current;
    if (!map) return;

    clearTrail();
    prevGeoRef.current = { lat: geo.lat, lon: geo.lon };

    if (markerRef.current) {
      markerRef.current.setLatLng([geo.lat, geo.lon]);
    }
    map.setView([geo.lat, geo.lon], map.getZoom());

    // Update coordinate display
    const latEl = document.getElementById("insights-live-lat");
    const lonEl = document.getElementById("insights-live-lon");
    if (latEl) latEl.textContent = String(geo.lat);
    if (lonEl) lonEl.textContent = String(geo.lon);
  }, [topicPath, geo?.lat, geo?.lon, clearTrail, mode]);

  // --- Handle navigation index changes in all mode -------------------------
  useEffect(() => {
    if (mode !== "all") return;
    const map = mapRef.current;
    if (!map || geoNodes.length === 0) return;

    updateHighlight(geoNodes, geoNavIndex);

    // Pan to the highlighted marker
    const target = geoNodes[geoNavIndex];
    if (target) {
      map.flyTo([target.geo.lat, target.geo.lon], map.getZoom(), { duration: 0.4 });
    }
  }, [geoNavIndex, mode, geoNodes, updateHighlight]);

  // --- Update all-mode markers when the set of geo topics changes ----------
  const prevGeoTopicsRef = useRef<string>("");
  useEffect(() => {
    if (mode !== "all") return;

    // Build a fingerprint of the current geo topic set to avoid
    // unnecessary full rebuilds (which would wipe trail data).
    const topicFingerprint = geoNodes.map((n) => n.topicPath).join("\0");

    if (topicFingerprint !== prevGeoTopicsRef.current) {
      // Topic set changed (added or removed) — full rebuild needed
      prevGeoTopicsRef.current = topicFingerprint;
      showAllMarkers(geoNodes, geoNavIndex);
    }
    // Position-only changes are handled by the store subscription,
    // not here — so trails are preserved.
  }, [geoNodes, mode, geoNavIndex, showAllMarkers]);

  // --- Store subscription for live geo updates (both modes) ----------------
  useEffect(() => {
    const unsubscribe = useTopicStore.subscribe(() => {
      const map = mapRef.current;
      if (!map) return;

      if (modeRef.current === "single") {
        // --- Single-topic mode: track one topic's position -------
        const liveGeo = getGeoForTopic(topicPath);
        if (!liveGeo) return;

        const prev = prevGeoRef.current;
        if (prev && prev.lat === liveGeo.lat && prev.lon === liveGeo.lon) return;

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

        // Update coordinate display
        const latEl = document.getElementById("insights-live-lat");
        const lonEl = document.getElementById("insights-live-lon");
        if (latEl) latEl.textContent = String(liveGeo.lat);
        if (lonEl) lonEl.textContent = String(liveGeo.lon);
      } else {
        // --- All-geo mode: track all topics' positions -----------
        const allTrails = allTrailsRef.current;
        const markerMap = allMarkersByTopicRef.current;

        // Iterate all tracked topics and check for position changes
        for (const [tp, ts] of allTrails) {
          const liveGeo = getGeoForTopic(tp);
          if (!liveGeo) continue;

          if (ts.prevPos.lat === liveGeo.lat && ts.prevPos.lon === liveGeo.lon) continue;

          // Position changed — add previous position to trail
          const now = Date.now();
          const trail = ts.trail;

          // Enforce cap — remove oldest dot if at limit
          if (trail.length >= MAX_TRAIL_POINTS) {
            const oldest = ts.dots.shift();
            if (oldest) map.removeLayer(oldest);
            trail.shift();
          }

          trail.push({ lat: ts.prevPos.lat, lon: ts.prevPos.lon, timestamp: now });

          // Create trail dot
          const dot = L.circleMarker([ts.prevPos.lat, ts.prevPos.lon], {
            radius: TRAIL_DOT_RADIUS,
            fillColor: TRAIL_DOT_COLOR,
            fillOpacity: TRAIL_DOT_OPACITY,
            stroke: false,
          }).addTo(map);

          dot.bindTooltip(`${tp}\n${formatTimestamp(now)}`, {
            direction: "top",
            offset: [0, -6],
            className: "trail-tooltip",
          });

          ts.dots.push(dot);

          // Update polyline: trail points + current position
          const linePoints: L.LatLngExpression[] = trail.map((p) => [p.lat, p.lon]);
          linePoints.push([liveGeo.lat, liveGeo.lon]);

          if (ts.polyline) {
            ts.polyline.setLatLngs(linePoints);
          } else if (linePoints.length >= 2) {
            ts.polyline = L.polyline(linePoints, {
              color: TRAIL_LINE_COLOR,
              opacity: TRAIL_LINE_OPACITY,
              weight: TRAIL_LINE_WEIGHT,
              smoothFactor: 1,
            }).addTo(map);
          }

          // Update marker position
          const marker = markerMap.get(tp);
          if (marker) {
            marker.setLatLng([liveGeo.lat, liveGeo.lon]);
          }

          ts.prevPos = { lat: liveGeo.lat, lon: liveGeo.lon };
        }
      }
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
        allMarkersRef.current = [];
        allMarkersByTopicRef.current.clear();
        allTrailsRef.current.clear();
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

  // --- Invalidate map size when switching tabs (map may have been hidden) ---
  useEffect(() => {
    if (activeTab === "map" && mapRef.current) {
      // Leaflet needs a resize kick when the container becomes visible again
      setTimeout(() => mapRef.current?.invalidateSize(), 50);
    }
  }, [activeTab]);

  // --- Derived values for rendering ----------------------------------------
  const hasGeo = geo !== null;
  const hasImage = imageBlobUrl !== null;
  const showTabs = hasGeo && hasImage;
  const showNav = geoNodes.length > 1 && activeTab === "map";
  const canToggleMode = geoNodes.length > 1;
  const navTopic = geoNodes[geoNavIndex]?.topicPath ?? topicPath;

  // Determine header label based on active tab and mode
  const headerLabel = (() => {
    if (activeTab === "image") return "Image Preview";
    if (mode === "all") return `All Locations (${geoNodes.length})`;
    if (isPinned) return "Pinned Location";
    return "Location";
  })();

  const headerDetail = (() => {
    if (activeTab === "image") return topicPath;
    if (mode === "all") return `${geoNodes.length} geo topic${geoNodes.length !== 1 ? "s" : ""}`;
    return topicPath;
  })();

  return (
    <div className={`absolute bottom-4 right-4 z-20 w-96 max-h-[calc(100vh-2rem)] flex flex-col bg-gray-900/95 backdrop-blur-sm border rounded-lg shadow-xl overflow-hidden animate-slide-up ${
      isPinned ? "border-amber-600/50 ring-1 ring-amber-500/20" : "border-gray-700"
    }`}>
      {/* Header */}
      <div className={`flex items-start gap-2 p-3 pb-2 border-b flex-shrink-0 ${isPinned ? "border-amber-600/40" : "border-gray-700/50"}`}>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
            {headerLabel}
          </div>
          <div className="text-xs font-mono text-gray-100 break-all leading-snug">
            {headerDetail}
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* Mode toggle — switch between single/all (map tab only) */}
          {canToggleMode && activeTab === "map" && (
            <button
              onClick={() => onSetMode(mode === "single" ? "all" : "single")}
              title={mode === "single" ? "Show all geo locations" : "Show single topic"}
              className={`p-0.5 transition-colors ${
                mode === "all"
                  ? "text-cyan-400 hover:text-cyan-300"
                  : "text-gray-500 hover:text-gray-200"
              }`}
            >
              {/* Globe/map icon */}
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <path strokeLinecap="round" d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
              </svg>
            </button>
          )}
          {/* Pin toggle — only in single mode, map tab */}
          {mode === "single" && activeTab === "map" && (
            <button
              onClick={onTogglePin}
              title={isPinned ? "Unpin — drawer follows node selection" : "Pin — keep this map open while browsing"}
              className={`p-0.5 transition-colors ${
                isPinned
                  ? "text-amber-400 hover:text-amber-300"
                  : "text-gray-500 hover:text-gray-200"
              }`}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v6l-2 4h5v6l1 2l1-2v-6h5l-2-4V4a1 1 0 0 0-1-1H10a1 1 0 0 0-1 1Z" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="p-0.5 text-gray-500 hover:text-gray-200 transition-colors"
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
      </div>

      {/* Tab bar — shown only when both geo and image are available */}
      {showTabs && (
        <div className="flex border-b border-gray-700/50 flex-shrink-0">
          <button
            onClick={() => onSetTab("map")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors ${
              activeTab === "map"
                ? "text-cyan-300 border-b-2 border-cyan-400"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {/* Map pin icon */}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
            </svg>
            Map
          </button>
          <button
            onClick={() => onSetTab("image")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors ${
              activeTab === "image"
                ? "text-purple-300 border-b-2 border-purple-400"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {/* Image icon */}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
            </svg>
            Image
          </button>
        </div>
      )}

      {/* Navigation bar — shown when multiple geo topics exist (map tab only) */}
      {showNav && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-700/50 flex-shrink-0">
          <button
            onClick={() => onNavigate((geoNavIndex - 1 + geoNodes.length) % geoNodes.length)}
            className="p-0.5 text-gray-500 hover:text-gray-200 transition-colors"
            title="Previous geo topic"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0 text-center">
            <span className="text-[10px] font-mono text-gray-400 truncate block">
              {navTopic}
            </span>
          </div>
          <span className="text-[10px] text-gray-500 tabular-nums flex-shrink-0">
            {geoNavIndex + 1}/{geoNodes.length}
          </span>
          <button
            onClick={() => onNavigate((geoNavIndex + 1) % geoNodes.length)}
            className="p-0.5 text-gray-500 hover:text-gray-200 transition-colors"
            title="Next geo topic"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {/* Coordinates — shown in single mode, map tab only */}
      {mode === "single" && activeTab === "map" && geo && (
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
      )}

      {/* Map — hidden (not destroyed) when image tab is active so Leaflet state is preserved */}
      <div className="flex-1 min-h-0" style={{ display: activeTab === "map" && hasGeo ? undefined : "none" }}>
        <div
          ref={mapContainerRef}
          className="w-full h-72"
          style={{ background: "#1e293b" }}
        />
      </div>

      {/* Image preview — shown when image tab is active */}
      {activeTab === "image" && imageBlobUrl && (
        <div className="flex-1 min-h-0 p-3 overflow-y-auto">
          <img
            src={imageBlobUrl}
            alt={`Image payload from ${topicPath}`}
            className="w-full rounded border border-gray-700/50"
            style={{ imageRendering: "auto" }}
          />
        </div>
      )}
    </div>
  );
}
