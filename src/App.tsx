import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useMqttClient, loadSavedConnection } from "./hooks/useMqttClient";
import { useTopicStore } from "./stores/topicStore";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { DetailPanel } from "./components/DetailPanel";
import { InsightsDrawer } from "./components/InsightsDrawer";
import { TopicGraph } from "./components/TopicGraph";
import { StatusBar } from "./components/StatusBar";
import { SettingsPanel } from "./components/SettingsPanel";
import { getConfig } from "./utils/config";
import { findNode } from "./utils/topicParser";
import { registerWebMcpTools, unregisterWebMcpTools } from "./services/webMcpService";
import type { GeoMetadata } from "./types/payloadTags";

function App() {
  const { connect, disconnect, connectionStatus } = useMqttClient();
  const errorMessage = useTopicStore((s) => s.errorMessage);
  const selectedNodeId = useTopicStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useTopicStore((s) => s.setSelectedNodeId);
  const graphNodes = useTopicStore((s) => s.graphNodes);
  const autoconnectFired = useRef(false);

  // Insights drawer state
  const [insightsGeo, setInsightsGeo] = useState<{ topicPath: string; geo: GeoMetadata } | null>(null);
  const [isInsightsPinned, setIsInsightsPinned] = useState(false);

  const handleOpenInsights = useCallback((geo: GeoMetadata) => {
    if (!selectedNodeId) return;
    setInsightsGeo({ topicPath: selectedNodeId, geo });
  }, [selectedNodeId]);

  const handleCloseInsights = useCallback(() => {
    setInsightsGeo(null);
    setIsInsightsPinned(false);
  }, []);

  const handleTogglePin = useCallback(() => {
    setIsInsightsPinned((prev) => !prev);
  }, []);

  // Close insights drawer (and unpin) on disconnect — the topic tree is
  // about to be cleared so the pinned map would show stale data.
  useEffect(() => {
    if (connectionStatus === "disconnected" && insightsGeo) {
      setInsightsGeo(null);
      setIsInsightsPinned(false);
    }
  }, [connectionStatus, insightsGeo]);

  // When node selection changes while the drawer is open, either update
  // it to show the new node's geo data or close it if the new node has none.
  // When pinned, the drawer stays on its current topic regardless of selection.
  useEffect(() => {
    if (!insightsGeo) return; // drawer already closed — nothing to do
    if (isInsightsPinned) return; // pinned — ignore node selection changes

    if (!selectedNodeId) {
      setInsightsGeo(null);
      return;
    }

    // Look up the newly selected node's topic data for geo tags
    const root = useTopicStore.getState().root;
    const segments = selectedNodeId === "" ? [] : selectedNodeId.split("/");
    const node = findNode(root, segments);
    const geoTag = node?.payloadTags?.find((t) => t.tag === "geo");

    if (geoTag) {
      // New node has geo — update the drawer in-place
      setInsightsGeo({ topicPath: selectedNodeId, geo: geoTag.metadata as GeoMetadata });
    } else {
      // New node has no geo — close the drawer
      setInsightsGeo(null);
    }
  }, [selectedNodeId, isInsightsPinned]);

  // Look up the selected node's data for the detail panel
  const selectedNodes = useMemo(() => {
    if (!selectedNodeId) return null;
    const root = useTopicStore.getState().root;
    const segments = selectedNodeId === "" ? [] : selectedNodeId.split("/");
    const topicNode = findNode(root, segments);
    const graphNode = graphNodes.find((n) => n.id === selectedNodeId);
    if (!topicNode || !graphNode) return null;
    return { topicNode, graphNode };
  }, [selectedNodeId, graphNodes]);

  // Autoconnect on initial mount if enabled
  useEffect(() => {
    if (autoconnectFired.current) return;
    autoconnectFired.current = true;

    const cfg = getConfig();
    const saved = loadSavedConnection();
    const shouldAutoconnect = saved.autoconnect ?? cfg.autoconnect ?? false;

    // Only autoconnect if the user has previously connected (brokerUrl in localStorage).
    // We do not fall back to config defaults — autoconnect without an explicit prior
    // connection would be surprising to a first-time visitor.
    if (shouldAutoconnect && saved.brokerUrl) {
      const brokerUrl = saved.brokerUrl;
      const topicFilter = saved.topicFilter ?? cfg.topicFilter ?? "";
      const username = saved.username ?? cfg.username ?? "";
      const password = cfg.password ?? "";

      // Determine client ID: config forced > localStorage > random
      const configForcesClientId = typeof cfg.clientId === "string" && cfg.clientId.length > 0;
      let clientId: string;
      if (configForcesClientId) {
        clientId = cfg.clientId as string;
      } else if (saved.customClientId && saved.clientId) {
        clientId = saved.clientId;
      } else {
        clientId = "mqtt_visualiser_" + Math.random().toString(16).slice(2, 10);
      }

      connect({
        brokerUrl,
        topicFilter,
        clientId,
        username: username || undefined,
        password: password || undefined,
      });
    }
  }, [connect]);

  // Register WebMCP tools on mount (no-op if navigator.modelContext unavailable)
  useEffect(() => {
    registerWebMcpTools();
    return () => unregisterWebMcpTools();
  }, []);

  return (
    <div className="relative w-full h-screen bg-slate-900">
      <TopicGraph />
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 max-h-[calc(100vh-2rem)]">
        <ConnectionPanel
          onConnect={connect}
          onDisconnect={disconnect}
          connectionStatus={connectionStatus}
          errorMessage={errorMessage}
        />
        {selectedNodes && (
          <DetailPanel
            topicNode={selectedNodes.topicNode}
            graphNode={selectedNodes.graphNode}
            onClose={() => setSelectedNodeId(null)}
            onOpenInsights={handleOpenInsights}
          />
        )}
      </div>
      {insightsGeo && (
        <InsightsDrawer
          topicPath={insightsGeo.topicPath}
          geo={insightsGeo.geo}
          isPinned={isInsightsPinned}
          onTogglePin={handleTogglePin}
          onClose={handleCloseInsights}
        />
      )}
      <SettingsPanel />
      <StatusBar />
      <a
        href="https://github.com/ryanbateman/mqtt_vis"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-4 left-4 z-10 text-gray-600 hover:text-gray-400 transition-colors"
        title="View on GitHub"
      >
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
        </svg>
      </a>
    </div>
  );
}

export default App;
