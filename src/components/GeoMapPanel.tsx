import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTopicStore } from "../stores/topicStore";
import { formatTimestamp } from "../utils/formatters";
import { getGeoForTopic } from "../utils/geoLookup";
import { geoMapCache, type CachedTrail } from "../utils/geoMapCache";
import { loadSavedSettings, persistSettings } from "../utils/settingsStorage";
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
import type { GeoNode } from "../types/payloadTags";

/** Leaflet layers drawing one topic's trail. Rebuilt from cached trail data. */
interface TrailLayers {
  dots: L.CircleMarker[];
  polyline: L.Polyline | null;
}

/** View used before any marker exists — whole world, so a fit is always sensible. */
const DEFAULT_CENTER: [number, number] = [20, 0];
const DEFAULT_ZOOM = 2;

/**
 * Global map panel: every geo-tagged topic as a pin on one map, with optional
 * per-topic movement trails.
 *
 * Unlike the Topic drawer's per-topic map, this view never follows anything —
 * it fits the markers once when first opened and thereafter only the user
 * moves it. New topics appearing must not yank the viewport out from under a
 * user who is panning around.
 *
 * The side rail unmounts inactive sections, so the Leaflet instance is
 * destroyed on every tab switch. Viewport and trail *data* live in
 * `geoMapCache`; layers are rebuilt from it on remount.
 */
export function GeoMapPanel({
  geoNodes,
  onSelectTopic,
}: {
  /** All currently detected geo-tagged topics. */
  geoNodes: GeoNode[];
  /** Called with a topic path when its marker is clicked. */
  onSelectTopic: (topicPath: string) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const trailLayersRef = useRef<Map<string, TrailLayers>>(new Map());
  /** Topic-set fingerprint — markers rebuild only when the set changes. */
  const fingerprintRef = useRef<string>("");
  /** The initial fit happens once, and only when no viewport was cached. */
  const didInitialFitRef = useRef(false);

  const [showTrails, setShowTrails] = useState(
    () => loadSavedSettings().geoTrailsEnabled ?? true,
  );
  // Read by the store subscription, which must not re-subscribe on toggle.
  const showTrailsRef = useRef(showTrails);
  showTrailsRef.current = showTrails;

  // Latest click handler, so markers built once keep calling the current prop.
  const onSelectTopicRef = useRef(onSelectTopic);
  onSelectTopicRef.current = onSelectTopic;

  const isEmpty = geoNodes.length === 0;

  // --- Trail layer helpers --------------------------------------------------

  /** Remove every trail layer from the map (trail *data* in the cache survives). */
  const clearTrailLayers = useCallback(() => {
    const map = mapRef.current;
    for (const layers of trailLayersRef.current.values()) {
      if (map) {
        for (const dot of layers.dots) map.removeLayer(dot);
        if (layers.polyline) map.removeLayer(layers.polyline);
      }
    }
    trailLayersRef.current.clear();
  }, []);

  /** Draw a dot for one recorded point, tooltipped with topic + time. */
  const makeDot = useCallback((map: L.Map, topicPath: string, lat: number, lon: number, timestamp: number) => {
    const dot = L.circleMarker([lat, lon], {
      radius: TRAIL_DOT_RADIUS,
      fillColor: TRAIL_DOT_COLOR,
      fillOpacity: TRAIL_DOT_OPACITY,
      stroke: false,
    }).addTo(map);
    dot.bindTooltip(`${topicPath}\n${formatTimestamp(timestamp)}`, {
      direction: "top",
      offset: [0, -6],
      className: "trail-tooltip",
    });
    return dot;
  }, []);

  /** Rebuild the polyline for one topic from its trail plus its live position. */
  const syncPolyline = useCallback((topicPath: string, cached: CachedTrail) => {
    const map = mapRef.current;
    if (!map) return;
    const layers = trailLayersRef.current.get(topicPath);
    if (!layers) return;

    const points: L.LatLngExpression[] = cached.trail.map((p) => [p.lat, p.lon]);
    points.push([cached.prevPos.lat, cached.prevPos.lon]);

    if (layers.polyline) {
      layers.polyline.setLatLngs(points);
    } else if (points.length >= 2) {
      layers.polyline = L.polyline(points, {
        color: TRAIL_LINE_COLOR,
        opacity: TRAIL_LINE_OPACITY,
        weight: TRAIL_LINE_WEIGHT,
        smoothFactor: 1,
      }).addTo(map);
    }
  }, []);

  /** Recreate every trail layer from cached trail data (after remount or toggle-on). */
  const drawTrailsFromCache = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    clearTrailLayers();
    for (const [topicPath, cached] of geoMapCache.trails) {
      const dots = cached.trail.map((p) => makeDot(map, topicPath, p.lat, p.lon, p.timestamp));
      trailLayersRef.current.set(topicPath, { dots, polyline: null });
      syncPolyline(topicPath, cached);
    }
  }, [clearTrailLayers, makeDot, syncPolyline]);

  // --- Map lifecycle --------------------------------------------------------

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    // Captured for the cleanup closure — these Map objects are created once
    // and never reassigned, so they are the same instances at teardown.
    const markers = markersRef.current;
    const trailLayers = trailLayersRef.current;

    const cachedView = geoMapCache.view;
    const map = L.map(mapContainerRef.current, {
      center: cachedView?.center ?? DEFAULT_CENTER,
      zoom: cachedView?.zoom ?? DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: TILE_MAX_ZOOM }).addTo(map);
    mapRef.current = map;

    // A cached viewport is the user's own pan/zoom — never override it.
    didInitialFitRef.current = cachedView !== null;

    const saveView = () => {
      const c = map.getCenter();
      geoMapCache.view = { center: [c.lat, c.lng], zoom: map.getZoom() };
    };
    map.on("moveend", saveView);
    map.on("zoomend", saveView);

    // The rail's expand transition is 200ms; Leaflet needs a kick once the
    // container has its final size or tiles render against a zero-width box.
    const resizeTimer = setTimeout(() => map.invalidateSize(), 350);

    return () => {
      clearTimeout(resizeTimer);
      saveView();
      map.off("moveend", saveView);
      map.off("zoomend", saveView);
      map.remove();
      mapRef.current = null;
      markers.clear();
      trailLayers.clear();
      fingerprintRef.current = "";
    };
  }, []);

  // Leaflet does not observe its container; the rail is drag-resizable.
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // --- Markers --------------------------------------------------------------

  /** Fit the viewport to every marker. Also the "Fit all" button's action. */
  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map || geoNodes.length === 0) return;
    const bounds = L.latLngBounds(geoNodes.map((n) => [n.geo.lat, n.geo.lon] as [number, number]));
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
  }, [geoNodes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Only the set of topics drives a rebuild; position changes are applied
    // incrementally by the store subscription so trails are never wiped.
    const fingerprint = geoNodes.map((n) => n.topicPath).join("\0");
    if (fingerprint === fingerprintRef.current) return;
    fingerprintRef.current = fingerprint;

    for (const marker of markersRef.current.values()) map.removeLayer(marker);
    markersRef.current.clear();

    for (const node of geoNodes) {
      const marker = L.marker([node.geo.lat, node.geo.lon], { icon: geoMarkerIcon }).addTo(map);
      marker.bindTooltip(node.topicPath, {
        direction: "top",
        offset: [0, -10],
        className: "trail-tooltip",
      });
      marker.on("click", () => onSelectTopicRef.current(node.topicPath));
      markersRef.current.set(node.topicPath, marker);

      // Seed trail tracking so the first movement has a previous position.
      if (!geoMapCache.trails.has(node.topicPath)) {
        geoMapCache.trails.set(node.topicPath, {
          trail: [],
          prevPos: { lat: node.geo.lat, lon: node.geo.lon, timestamp: node.geo.timestamp },
        });
      }
    }

    // Drop cached trails for topics that no longer exist (pruned).
    const live = new Set(geoNodes.map((n) => n.topicPath));
    for (const topicPath of [...geoMapCache.trails.keys()]) {
      if (!live.has(topicPath)) geoMapCache.trails.delete(topicPath);
    }

    if (showTrailsRef.current) drawTrailsFromCache();

    // Fit once, and only if the user has no cached viewport to return to.
    if (!didInitialFitRef.current && geoNodes.length > 0) {
      didInitialFitRef.current = true;
      fitAll();
    }
  }, [geoNodes, drawTrailsFromCache, fitAll]);

  // --- Trails toggle --------------------------------------------------------

  useEffect(() => {
    if (!mapRef.current) return;
    if (showTrails) drawTrailsFromCache();
    else clearTrailLayers();
  }, [showTrails, drawTrailsFromCache, clearTrailLayers]);

  const handleToggleTrails = useCallback(() => {
    setShowTrails((prev) => {
      persistSettings({ geoTrailsEnabled: !prev });
      return !prev;
    });
  }, []);

  // --- Live position updates ------------------------------------------------

  useEffect(() => {
    const unsubscribe = useTopicStore.subscribe(() => {
      const map = mapRef.current;
      if (!map) return;

      for (const [topicPath, marker] of markersRef.current) {
        const liveGeo = getGeoForTopic(topicPath);
        if (!liveGeo) continue;

        const cached = geoMapCache.trails.get(topicPath);
        if (!cached) continue;
        if (cached.prevPos.lat === liveGeo.lat && cached.prevPos.lon === liveGeo.lon) continue;

        // Trail *data* accrues even while trails are hidden, so toggling them
        // back on reveals the history rather than starting from empty.
        const stamp = cached.prevPos.timestamp ?? Date.now();
        if (cached.trail.length >= MAX_TRAIL_POINTS) {
          cached.trail.shift();
          const layers = trailLayersRef.current.get(topicPath);
          const oldest = layers?.dots.shift();
          if (oldest) map.removeLayer(oldest);
        }
        cached.trail.push({ lat: cached.prevPos.lat, lon: cached.prevPos.lon, timestamp: stamp });

        if (showTrailsRef.current) {
          let layers = trailLayersRef.current.get(topicPath);
          if (!layers) {
            layers = { dots: [], polyline: null };
            trailLayersRef.current.set(topicPath, layers);
          }
          layers.dots.push(makeDot(map, topicPath, cached.prevPos.lat, cached.prevPos.lon, stamp));
        }

        marker.setLatLng([liveGeo.lat, liveGeo.lon]);
        cached.prevPos = { lat: liveGeo.lat, lon: liveGeo.lon, timestamp: liveGeo.timestamp };

        if (showTrailsRef.current) syncPolyline(topicPath, cached);
      }
    });
    return unsubscribe;
  }, [makeDot, syncPolyline]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Controls — trail toggle + manual fit */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-gray-700/50 flex-shrink-0">
        <span className="text-[10px] text-gray-500">
          {isEmpty
            ? "No geo topics"
            : `${geoNodes.length} geo ${geoNodes.length === 1 ? "topic" : "topics"}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleToggleTrails}
            title={showTrails ? "Hide movement trails" : "Show movement trails"}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              showTrails ? "bg-cyan-600/30 text-cyan-300" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Trails
          </button>
          <button
            onClick={fitAll}
            disabled={isEmpty}
            title="Fit all markers"
            className="p-0.5 text-gray-500 hover:text-gray-200 disabled:text-gray-700 disabled:hover:text-gray-700 transition-colors"
          >
            {/* Arrows-out / fit icon */}
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Map — always mounted so Leaflet keeps its state while topics come and go */}
      <div className="relative flex-1 min-h-0">
        <div ref={mapContainerRef} className="w-full h-full" style={{ background: "#1e293b" }} />
        {isEmpty && (
          <div className="absolute inset-0 z-[500] flex items-center justify-center bg-gray-900/80 text-[11px] text-gray-500 pointer-events-none">
            No geo-tagged topics detected yet.
          </div>
        )}
      </div>
    </div>
  );
}
