import { useState, useEffect } from "react";
import type { TopicNode, GraphNode } from "../types";
import { formatRate, formatTimestamp, formatPayloadSize } from "../utils/formatters";

/**
 * Fixed sidebar panel showing detailed information about the selected/pinned node.
 * Displayed on the left side of the graph when a node is clicked.
 */
export function DetailPanel({
  topicNode,
  graphNode,
  onClose,
}: {
  topicNode: TopicNode;
  graphNode: GraphNode;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [prettyJson, setPrettyJson] = useState(false);

  // Reset pretty-print toggle when switching to a different node
  useEffect(() => {
    setPrettyJson(false);
  }, [graphNode.id]);

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

  const childCount = topicNode.children.size;

  return (
    <div className="bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg shadow-xl w-80 flex flex-col overflow-hidden">
      {/* Header with topic path and close button */}
      <div className="flex items-start gap-2 p-3 pb-2 border-b border-gray-700/50">
        <div className="flex-1 min-w-0">
          <button
            onClick={handleCopy}
            title="Copy topic path"
            className="text-xs font-mono text-gray-100 break-all leading-snug text-left hover:text-blue-300 transition-colors cursor-pointer"
          >
            {topicPath}
          </button>
          {copied && (
            <span className="text-[10px] text-blue-400 ml-1">Copied!</span>
          )}
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
            {formatRate(graphNode.aggregateRate)} msg/s
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
      </div>

      {/* Payload — full content, scrollable */}
      {topicNode.lastPayload !== null && (
        <div className="p-3 overflow-y-auto min-h-0 flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-500">Last Payload</span>
            {isJson && (
              <button
                onClick={() => setPrettyJson(!prettyJson)}
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
          <pre className="text-[11px] font-mono text-gray-300 whitespace-pre-wrap break-all leading-snug max-h-60 overflow-y-auto">
            {prettyJson && formattedPayload ? formattedPayload : topicNode.lastPayload}
          </pre>
        </div>
      )}
    </div>
  );
}
