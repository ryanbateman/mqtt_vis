import type { TopicNode, GraphNode } from "../types";
import { formatRate, formatTimestamp, truncatePayload } from "../utils/formatters";

/** Offset from the node centre to the tooltip edge. */
const OFFSET_X = 12;
const OFFSET_Y = 12;

export function NodeTooltip({
  topicNode,
  graphNode,
  screenX,
  screenY,
}: {
  topicNode: TopicNode;
  graphNode: GraphNode;
  screenX: number;
  screenY: number;
}) {
  // Determine which side of the cursor to place the tooltip
  const flipX = screenX > window.innerWidth - 280;
  const flipY = screenY > window.innerHeight - 200;

  const style: React.CSSProperties = {
    position: "fixed",
    left: flipX ? undefined : screenX + OFFSET_X,
    right: flipX ? window.innerWidth - screenX + OFFSET_X : undefined,
    top: flipY ? undefined : screenY + OFFSET_Y,
    bottom: flipY ? window.innerHeight - screenY + OFFSET_Y : undefined,
    zIndex: 9999,
  };

  return (
    <div
      style={style}
      className="pointer-events-none bg-gray-900/95 backdrop-blur-sm border border-gray-600 rounded-lg px-3 py-2.5 shadow-xl max-w-72"
    >
      {/* Full topic path */}
      <div className="text-xs font-mono text-gray-100 break-all leading-snug mb-2">
        {graphNode.id || "(root)"}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
        <span className="text-gray-500">Rate</span>
        <span className="text-gray-300 font-mono">{formatRate(graphNode.messageRate)} msg/s</span>

        <span className="text-gray-500">Agg. Rate</span>
        <span className="text-gray-300 font-mono">{topicNode.children.size === 0 ? "—" : `${formatRate(graphNode.aggregateRate)} msg/s`}</span>

        <span className="text-gray-500">Messages</span>
        <span className="text-gray-300 font-mono">{topicNode.messageCount.toLocaleString()}</span>

        <span className="text-gray-500">Depth</span>
        <span className="text-gray-300 font-mono">{graphNode.depth}</span>

        <span className="text-gray-500">QoS</span>
        <span className="text-gray-300 font-mono">{topicNode.messageCount > 0 ? topicNode.lastQoS : "-"}</span>

        <span className="text-gray-500">Last seen</span>
        <span className="text-gray-300 font-mono">{formatTimestamp(topicNode.lastTimestamp)}</span>
      </div>

      {/* Payload */}
      {topicNode.lastPayload !== null && (
        <div className="mt-2 pt-1.5 border-t border-gray-700/50">
          <div className="text-[10px] text-gray-500 mb-0.5">Last Payload</div>
          <div className="text-[11px] font-mono text-gray-300 break-all leading-snug">
            {truncatePayload(topicNode.lastPayload)}
          </div>
        </div>
      )}
    </div>
  );
}
