import { useEffect, useState } from "react";
import { useTopicStore, TOPIC_NODE_CAP } from "../stores/topicStore";
import { formatUptime } from "../utils/formatters";
import { useDomainEntities } from "./EcosystemsPanel";
import { entityEcosystemCounts } from "../utils/statsAggregate";
import { ECOSYSTEM_REGISTRY } from "../utils/ecosystemRegistry";

export function StatusBar() {
  const totalMessages = useTopicStore((s) => s.totalMessages);
  const totalTopics = useTopicStore((s) => s.totalTopics);
  const connectionStatus = useTopicStore((s) => s.connectionStatus);
  const sessionStart = useTopicStore((s) => s.sessionStart);
  const nodeCapReached = useTopicStore((s) => s.nodeCapReached);
  const shakeLayout = useTopicStore((s) => s.shakeLayout);
  const isShaking = useTopicStore((s) => s.isShaking);
  const entities = useDomainEntities();
  const [uptime, setUptime] = useState("0s");

  // One small block per discovered ecosystem, in registry order so blocks
  // don't reshuffle as counts change. Colour matches the ecosystem's nodes.
  const ecoCounts = entityEcosystemCounts(entities);
  const ecoBlocks = ECOSYSTEM_REGISTRY.filter((eco) => (ecoCounts.get(eco.id) ?? 0) > 0);

  useEffect(() => {
    if (connectionStatus !== "connected") {
      setUptime("0s");
      return;
    }

    const interval = setInterval(() => {
      setUptime(formatUptime(Date.now() - sessionStart));
    }, 1000);

    return () => clearInterval(interval);
  }, [connectionStatus, sessionStart]);

  if (connectionStatus === "disconnected") return null;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2">
      {/* Node cap banner — the tree is full and new topics are being dropped */}
      {nodeCapReached && (
        <div
          className="bg-amber-950/90 backdrop-blur-sm border border-amber-600/50 rounded-lg px-4 py-1.5 shadow-xl flex items-center gap-2 text-xs text-amber-200"
          role="alert"
        >
          {/* Warning triangle icon */}
          <svg className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          </svg>
          <span>
            Topic limit reached ({TOPIC_NODE_CAP.toLocaleString()} nodes) — new topics are
            hidden. Narrow your topic filter or enable pruning.
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2 max-w-[92vw]">
        {/* Shake layout — standalone box just left of the metrics */}
        <button
          type="button"
          onClick={() => shakeLayout()}
          disabled={connectionStatus !== "connected" || isShaking}
          title={
            connectionStatus === "connected"
              ? "Shake the layout to spread it out"
              : "Connect to enable layout shake"
          }
          aria-label="Shake layout"
          className={`bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg px-3 py-2 shadow-xl transition-colors ${
            connectionStatus !== "connected"
              ? "text-gray-700 cursor-not-allowed"
              : isShaking
                ? "text-blue-400 animate-pulse"
                : "text-gray-400 hover:text-gray-100"
          }`}
        >
          {/* Shake — a node with side-to-side motion trails */}
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="2.75" />
            <path d="M7.5 9.5v5M5 11v2" />
            <path d="M16.5 9.5v5M19 11v2" />
          </svg>
        </button>

        <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg px-6 py-2 shadow-xl flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-400">Messages:</span>
            <span className="text-gray-100 font-mono">{totalMessages.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-400">Topics:</span>
            <span className="text-gray-100 font-mono">{totalTopics.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-400">Uptime:</span>
            <span className="text-gray-100 font-mono">{uptime}</span>
          </div>
        </div>

        {/* One block per discovered ecosystem — name, device count, colour dot */}
        {ecoBlocks.map((eco) => (
          <div
            key={eco.id}
            className="bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg px-3 py-2 shadow-xl flex items-center gap-2 text-sm"
            title={`${eco.label} — ${ecoCounts.get(eco.id)} discovered`}
          >
            <span className="text-gray-200">
              {eco.label} <span className="text-gray-400">({ecoCounts.get(eco.id)})</span>
            </span>
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: eco.color }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
