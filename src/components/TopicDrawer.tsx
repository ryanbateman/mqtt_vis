import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTopicStore } from "../stores/topicStore";
import { formatTimestamp } from "../utils/formatters";
import { type InsightsTab } from "../utils/tagRegistry";
import { getGeoForTopic } from "../utils/geoLookup";
import {
  geoMarkerIcon,
  MAX_TRAIL_POINTS,
  TRAIL_DOT_RADIUS,
  TRAIL_DOT_COLOR,
  TRAIL_DOT_OPACITY,
  TRAIL_LINE_COLOR,
  TRAIL_LINE_OPACITY,
  TRAIL_LINE_WEIGHT,
  TILE_URL,
  TILE_ATTRIBUTION,
  TILE_MAX_ZOOM,
} from "../utils/mapMarkers";
import { SparkplugDevicePanel } from "./SparkplugDevicePanel";
import { TopicPayloadPanel, TopicStatsPanel } from "./TopicPayloadPanel";
import type { TopicNode, GraphNode } from "../types";
import type { GeoMetadata, TrailPoint } from "../types/payloadTags";
import type { SparkplugMetadata } from "../types/sparkplug";

export type { InsightsTab };

/** Tabs of the Topic drawer: the always-present payload tab plus detected insight tabs. */
export type TopicTab = "payload" | InsightsTab;

/**
 * Topic drawer: everything about one selected (or pinned) node behind a
 * unified tab bar — Payload (stats + last payload + user properties) plus
 * Map / Image / Device tabs when that content is detected. The Map tab shows
 * this one topic's coordinates and its historical trail; the global view of
 * every geo topic lives in the right rail's Map panel (`GeoMapPanel`).
 *
 * React owns the container elements; Leaflet manages the map inside a ref
 * (same pattern as D3 in GraphRenderer).
 */
export function TopicDrawer({
  topicPath,
  topicNode,
  graphNode,
  geo,
  imageBlobUrl,
  sparkplug,
  activeTab,
  onSetTab,
  isPinned,
  onTogglePin,
  onClose,
}: {
  /** Full topic path of the displayed node. */
  topicPath: string;
  /** Tree node for the payload tab (null when the node was pruned). */
  topicNode: TopicNode | null;
  /** Graph node for the payload tab's stats (null when not in the graph). */
  graphNode: GraphNode | null;
  /** Detected geo coordinates to display on the map (null if no geo data). */
  geo: GeoMetadata | null;
  /** Blob URL for an image payload preview (null if no image). */
  imageBlobUrl: string | null;
  /** Sparkplug metadata for the selected node (null if not a sparkplug topic). */
  sparkplug: SparkplugMetadata | null;
  /** Which content tab is currently active. */
  activeTab: TopicTab;
  /** Switch the active content tab. */
  onSetTab: (tab: TopicTab) => void;
  /** Whether the drawer is pinned (stays open across node selection changes). */
  isPinned: boolean;
  /** Toggle the pinned state. */
  onTogglePin: () => void;
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
  const prevGeoRef = useRef<{ lat: number; lon: number; timestamp?: number } | null>(null);

  // --- Trail helpers --------------------------------------------------------

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

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: TILE_MAX_ZOOM,
    }).addTo(map);

    mapRef.current = map;

    const marker = L.marker([geo.lat, geo.lon], { icon: geoMarkerIcon }).addTo(map);
    markerRef.current = marker;
    prevGeoRef.current = { lat: geo.lat, lon: geo.lon, timestamp: geo.timestamp };

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

  // --- Handle topic path changes -------------------------------------------
  useEffect(() => {
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
  }, [topicPath, geo?.lat, geo?.lon, clearTrail]);

  // --- Store subscription for live geo updates -----------------------------
  useEffect(() => {
    const unsubscribe = useTopicStore.subscribe(() => {
      const map = mapRef.current;
      if (!map) return;

      const liveGeo = getGeoForTopic(topicPath);
      if (!liveGeo) return;

      const prev = prevGeoRef.current;
      if (prev && prev.lat === liveGeo.lat && prev.lon === liveGeo.lon) return;

      // Position changed — push previous position to trail, stamped with
      // the reading's own time (OwnTracks tst) when we have it.
      if (prev) {
        addTrailPoint({ lat: prev.lat, lon: prev.lon, timestamp: prev.timestamp ?? Date.now() });
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

      prevGeoRef.current = { lat: liveGeo.lat, lon: liveGeo.lon, timestamp: liveGeo.timestamp };

      // Update coordinate display
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

  // --- Invalidate map size when switching tabs (map may have been hidden) ---
  useEffect(() => {
    if (activeTab === "map" && mapRef.current) {
      // Leaflet needs a resize kick when the container becomes visible again
      setTimeout(() => mapRef.current?.invalidateSize(), 50);
    }
  }, [activeTab]);

  // --- Invalidate map size when the container resizes (resizable rail) ------
  // Leaflet does not observe its container, so tiles would misalign while
  // the drawer is drag-resized without this.
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      mapRef.current?.invalidateSize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // --- Topic path copy ------------------------------------------------------
  const [copied, setCopied] = useState(false);
  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(topicPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be unavailable in insecure contexts
    }
  };

  // --- Derived values for rendering ----------------------------------------
  const hasGeo = geo !== null;
  const hasImage = imageBlobUrl !== null;
  const hasSparkplug = sparkplug !== null;
  const anyInsightTabs = hasGeo || hasImage || hasSparkplug;
  // The payload tab always exists; show the bar once any insight tab joins it.
  const showTabs = anyInsightTabs;

  return (
    <div className={`flex-1 min-h-0 flex flex-col overflow-hidden ${
      isPinned ? "ring-1 ring-inset ring-amber-500/30" : ""
    }`}>
      {/* Header — copyable topic path + map controls + close */}
      <div className={`flex items-start gap-2 p-3 pb-2 border-b flex-shrink-0 ${isPinned ? "border-amber-600/40" : "border-gray-700/50"}`}>
        <div className="flex-1 min-w-0">
          {isPinned && (
            <div className="text-[10px] uppercase tracking-wider text-amber-400/80 mb-0.5">
              Pinned
            </div>
          )}
          <button
            onClick={handleCopyPath}
            title="Copy topic path"
            className="group flex items-start gap-1.5 text-left cursor-pointer"
          >
            <span className="text-xs font-mono text-gray-100 break-all leading-snug group-hover:text-blue-300 transition-colors">
              {topicPath || "(root)"}
            </span>
            <span className="flex-shrink-0 mt-0.5 text-gray-500 group-hover:text-blue-400 transition-colors">
              {copied ? (
                /* Checkmark — confirms copy succeeded */
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : (
                /* Clipboard icon */
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                </svg>
              )}
            </span>
          </button>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* Pin toggle — map tab only */}
          {activeTab === "map" && (
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

      {/* Stats — always visible for the displayed topic, above the tab bar */}
      {topicNode && graphNode && (
        <TopicStatsPanel topicNode={topicNode} graphNode={graphNode} />
      )}

      {/* Tab bar — shown when any insight tab joins the payload tab */}
      {showTabs && (
        <div className="flex border-b border-gray-700/50 flex-shrink-0">
          <button
            onClick={() => onSetTab("payload")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors ${
              activeTab === "payload"
                ? "text-blue-300 border-b-2 border-blue-400"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {/* Document icon */}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            Payload
          </button>
          {hasGeo && (
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
          )}
          {hasImage && (
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
          )}
          {hasSparkplug && (
            <button
              onClick={() => onSetTab("device")}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors ${
                activeTab === "device"
                  ? "text-emerald-300 border-b-2 border-emerald-400"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {/* CPU chip icon */}
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M15.75 3v1.5M8.25 19.5V21M15.75 19.5V21M3 8.25h1.5M3 15.75h1.5M19.5 8.25H21M19.5 15.75H21M7.5 6h9A1.5 1.5 0 0 1 18 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 16.5v-9A1.5 1.5 0 0 1 7.5 6Z" />
              </svg>
              Device
            </button>
          )}
        </div>
      )}

      {/* Coordinates — map tab only */}
      {activeTab === "map" && geo && (
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
          className="w-full h-full"
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

      {/* Sparkplug device panel — shown when device tab is active */}
      {activeTab === "device" && sparkplug && (
        <SparkplugDevicePanel deviceKey={sparkplug.deviceKey} />
      )}

      {/* Payload tab — last payload and user properties */}
      {activeTab === "payload" &&
        (topicNode ? (
          <TopicPayloadPanel topicNode={topicNode} />
        ) : (
          <div className="p-3 text-xs text-gray-500">
            Topic data unavailable — the node may have been pruned.
          </div>
        ))}
    </div>
  );
}
