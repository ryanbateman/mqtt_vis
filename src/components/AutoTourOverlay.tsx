import { useTopicStore } from "../stores/topicStore";
import { mqttService } from "../services/mqttService";
import { loadSavedConnection } from "../hooks/useMqttClient";

/**
 * Minimal corner overlay for auto-tour mode: a top-left watermark showing the
 * connected broker URL and subscribed topic, and (when pruning is enabled) a
 * caption explaining why inactive topics disappear. Caller-gated to auto-tour.
 */
export function AutoTourOverlay() {
  const pruneTimeout = useTopicStore((s) => s.pruneTimeout);
  const topicFilter = useTopicStore((s) => s.topicFilter);
  // Re-render when the connection state changes so the broker URL appears once connected.
  const connectionStatus = useTopicStore((s) => s.connectionStatus);
  const brokerUrl = mqttService.lastBrokerUrl || loadSavedConnection().brokerUrl || "";

  const dotClass =
    connectionStatus === "connected"
      ? "bg-emerald-500"
      : connectionStatus === "connecting"
        ? "bg-amber-500"
        : connectionStatus === "error"
          ? "bg-red-500"
          : "bg-gray-600";

  return (
    <>
      {(brokerUrl || topicFilter) && (
        <div className="absolute top-4 left-4 z-10 max-w-[60vw] bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg px-4 py-2 shadow-xl select-none">
          {brokerUrl && (
            <div className="flex items-center gap-2 text-sm">
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
              <span className="text-gray-100 font-mono truncate">{brokerUrl}</span>
            </div>
          )}
          {topicFilter && (
            <div className="flex items-center gap-2 text-xs mt-1">
              <span className="text-gray-400">Topic:</span>
              <span className="text-gray-200 font-mono truncate">{topicFilter}</span>
            </div>
          )}
        </div>
      )}
      {pruneTimeout > 0 && (
        <div className="absolute bottom-2 left-3 z-10 text-[11px] text-gray-500/70 pointer-events-none select-none">
          Inactive topics removed after {Math.round(pruneTimeout / 1000)}s
        </div>
      )}
    </>
  );
}
