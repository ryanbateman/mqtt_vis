import { useState, Fragment } from "react";
import type { TopicNode, GraphNode } from "../types";
import type { GeoMetadata, ImageMetadata } from "../types/payloadTags";
import { formatRate, formatTimestamp, formatPayloadSize } from "../utils/formatters";

/**
 * Session-scoped pretty-print preference. Persists across node selections so
 * the user's toggle choice isn't reset every time they click a different node.
 * Defaults to true — JSON payloads are pretty-printed by default.
 */
let _prettyJsonPref = true;

/**
 * Fixed sidebar panel showing detailed information about the selected/pinned node.
 * Displayed on the left side of the graph when a node is clicked.
 */
export function DetailPanel({
  topicNode,
  graphNode,
  onClose,
  onOpenInsights,
  onOpenInsightsImage,
}: {
  topicNode: TopicNode;
  graphNode: GraphNode;
  onClose: () => void;
  /** Called when the user clicks the map pin to view geo coordinates. */
  onOpenInsights?: (geo: GeoMetadata) => void;
  /** Called when the user clicks the image button to view image preview in Insights Drawer. */
  onOpenInsightsImage?: (imageBlobUrl: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [prettyJson, setPrettyJson] = useState(_prettyJsonPref);

  const topicPath = graphNode.id || "(root)";

  // Try to parse the payload as JSON for pretty-printing.
  // Only format objects/arrays — bare strings/numbers stay raw.
  const formattedPayload = (() => {
    if (!topicNode.lastPayload) return null;
    try {
      const parsed = JSON.parse(topicNode.lastPayload);
      if (typeof parsed === "object" && parsed !== null) {
        return JSON.stringify(parsed, null, 2);
      }
    } catch { /* not JSON */ }
    return null;
  })();

  const isJson = formattedPayload !== null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(graphNode.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select the text (clipboard API may be unavailable)
    }
  };

  const handleCopyPayload = async () => {
    const text = prettyJson && formattedPayload ? formattedPayload : topicNode.lastPayload;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPayload(true);
      setTimeout(() => setCopiedPayload(false), 1500);
    } catch {
      // Clipboard API may be unavailable in insecure contexts
    }
  };

  const childCount = topicNode.children.size;

  // Extract first geo detection result (if any) for the map button
  const geoTag = topicNode.payloadTags?.find((t) => t.tag === "geo");
  const geoMetadata = geoTag ? (geoTag.metadata as GeoMetadata) : null;

  // Extract first image detection result (if any)
  const imageTag = topicNode.payloadTags?.find((t) => t.tag === "image");
  const imageMetadata = imageTag ? (imageTag.metadata as ImageMetadata) : null;

  return (
    <div className="bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg shadow-xl w-80 flex flex-col overflow-hidden">
      {/* Header with topic path and close button */}
      <div className="flex items-start gap-2 p-3 pb-2 border-b border-gray-700/50">
        <div className="flex-1 min-w-0">
          <button
            onClick={handleCopy}
            title="Copy topic path"
            className="group flex items-start gap-1.5 text-left cursor-pointer"
          >
            <span className="text-xs font-mono text-gray-100 break-all leading-snug group-hover:text-blue-300 transition-colors">
              {topicPath}
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

      {/* Stats */}
      <div className="p-3 border-b border-gray-700/50">
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          <span className="text-gray-500">Rate</span>
          <span className="text-gray-300 font-mono">
            {formatRate(graphNode.messageRate)} msg/s
          </span>

          <span className="text-gray-500">Agg. Rate</span>
          <span className="text-gray-300 font-mono">
            {childCount === 0 ? "—" : `${formatRate(graphNode.aggregateRate)} msg/s`}
          </span>

          <span className="text-gray-500">Messages</span>
          <span className="text-gray-300 font-mono">
            {topicNode.messageCount.toLocaleString()}
          </span>

          <span className="text-gray-500">Depth</span>
          <span className="text-gray-300 font-mono">{graphNode.depth}</span>

          <span className="text-gray-500">Children</span>
          <span className="text-gray-300 font-mono">{childCount}</span>

          <span className="text-gray-500">QoS</span>
          <span className="text-gray-300 font-mono">
            {topicNode.messageCount > 0 ? topicNode.lastQoS : "-"}
          </span>

          <span className="text-gray-500">Last seen</span>
          <span className="text-gray-300 font-mono">
            {formatTimestamp(topicNode.lastTimestamp)}
          </span>

          <span className="text-gray-500">Payload size</span>
          <span className="text-gray-300 font-mono">
            {topicNode.messageCount > 0 ? formatPayloadSize(topicNode.lastPayloadSize) : "-"}
          </span>

          <span className="text-gray-500">Largest payload</span>
          <span className="text-gray-300 font-mono">
            {topicNode.messageCount > 0 ? formatPayloadSize(topicNode.largestPayloadSize) : "-"}
          </span>
        </div>

        {/* Geo insights button — shown when lat/lon detected in payload */}
        {geoMetadata && onOpenInsights && (
          <button
            onClick={() => onOpenInsights(geoMetadata)}
            className="mt-2 w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] font-medium text-cyan-300 bg-cyan-900/20 border border-cyan-800/30 hover:bg-cyan-900/40 transition-colors cursor-pointer"
            title={`View location: ${geoMetadata.lat}, ${geoMetadata.lon}`}
          >
            {/* Map pin icon */}
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
            </svg>
            <span>
              View on Map
              <span className="text-cyan-400/60 ml-1">
                {geoMetadata.lat.toFixed(4)}, {geoMetadata.lon.toFixed(4)}
              </span>
            </span>
          </button>
        )}

        {/* Image insights button — shown when image data detected in payload */}
        {imageMetadata && topicNode.lastImageBlobUrl && onOpenInsightsImage && (
          <button
            onClick={() => onOpenInsightsImage(topicNode.lastImageBlobUrl!)}
            className="mt-2 w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] font-medium text-purple-300 bg-purple-900/20 border border-purple-800/30 hover:bg-purple-900/40 transition-colors cursor-pointer"
            title={`View image: ${imageMetadata.format.toUpperCase()}`}
          >
            {/* Image icon */}
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
            </svg>
            <span>
              View Image
              <span className="text-purple-400/60 ml-1">
                {imageMetadata.format.toUpperCase()}
                {imageMetadata.subFormat && ` (${imageMetadata.subFormat.toUpperCase()})`}
              </span>
              <span className="text-purple-400/60 ml-1">
                {formatPayloadSize(imageMetadata.sizeBytes)}
              </span>
            </span>
          </button>
        )}
        {/* Image tag indicator (no blob URL available yet) — static, non-clickable */}
        {imageMetadata && !topicNode.lastImageBlobUrl && (
          <div className="mt-2 w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] font-medium text-purple-300 bg-purple-900/20 border border-purple-800/30">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
            </svg>
            <span>
              {imageMetadata.format.toUpperCase()}
              {imageMetadata.subFormat && (
                <span className="text-purple-400/60 ml-1">
                  ({imageMetadata.subFormat.toUpperCase()})
                </span>
              )}
              <span className="text-purple-400/60 ml-1">
                {formatPayloadSize(imageMetadata.sizeBytes)}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Payload — full content, scrollable */}
      {topicNode.lastPayload !== null && (
        <div className="p-3 overflow-y-auto min-h-0 flex-1 border-t border-gray-700/50">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-500">Last Payload</span>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopyPayload}
                className="text-gray-500 hover:text-gray-300 transition-colors p-0.5"
                title="Copy payload"
              >
                {copiedPayload ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                  </svg>
                )}
              </button>
              {isJson && (
                <button
                  onClick={() => { _prettyJsonPref = !prettyJson; setPrettyJson(!prettyJson); }}
                  className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                    prettyJson
                      ? "bg-blue-600/30 text-blue-300"
                      : "text-gray-500 hover:text-gray-300"
                  }`}
                  title="Toggle JSON pretty-print"
                >
                  {"{ }"}
                </button>
              )}
            </div>
          </div>
          <pre className="text-[11px] font-mono text-gray-300 whitespace-pre-wrap break-all leading-snug max-h-60 overflow-y-auto">
            {prettyJson && formattedPayload ? formattedPayload : topicNode.lastPayload}
          </pre>
        </div>
      )}

      {/* User Properties — MQTT v5 key-value pairs */}
      {topicNode.lastUserProperties !== null && Object.keys(topicNode.lastUserProperties).length > 0 && (
        <div className="p-3 overflow-y-auto min-h-0 border-t border-gray-700/50">
          <div className="mb-1">
            <span className="text-[10px] text-gray-500">User Properties</span>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
            {Object.entries(topicNode.lastUserProperties).map(([key, value]) => (
              <Fragment key={key}>
                <span className="text-gray-500 font-mono">{key}</span>
                <span className="text-gray-300 font-mono break-all">
                  {Array.isArray(value) ? value.join(", ") : value}
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
