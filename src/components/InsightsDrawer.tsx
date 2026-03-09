import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoMetadata } from "../types/payloadTags";

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
 * Slide-out drawer displaying rich insights for a selected node.
 * Currently supports geo coordinate display via a Leaflet map.
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
  /** Detected geo coordinates to display on the map. */
  geo: GeoMetadata;
  /** Called when the drawer is closed. */
  onClose: () => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  // Initialize Leaflet map on mount; update marker when geo changes
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // If map already exists, update its view and marker
    if (mapRef.current) {
      mapRef.current.setView([geo.lat, geo.lon], 13);
      // Remove existing markers and add new one
      mapRef.current.eachLayer((layer) => {
        if (layer instanceof L.Marker) {
          mapRef.current!.removeLayer(layer);
        }
      });
      L.marker([geo.lat, geo.lon], { icon: geoMarkerIcon }).addTo(mapRef.current);
      return;
    }

    // Create new map
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

    L.marker([geo.lat, geo.lon], { icon: geoMarkerIcon }).addTo(map);

    mapRef.current = map;

    // Leaflet needs a resize kick after the container transitions in
    const resizeTimer = setTimeout(() => {
      map.invalidateSize();
    }, 350);

    return () => {
      clearTimeout(resizeTimer);
    };
  }, [geo.lat, geo.lon]);

  // Clean up map on unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Close on Escape
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
          <span className="text-gray-300 font-mono">{geo.lat}</span>
          <span className="text-gray-500">Longitude</span>
          <span className="text-gray-300 font-mono">{geo.lon}</span>
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
