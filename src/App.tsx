import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useMqttClient, loadSavedConnection } from "./hooks/useMqttClient";
import { useTopicStore } from "./stores/topicStore";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { DetailPanel } from "./components/DetailPanel";
import { EcosystemsPanel, useDomainEntities } from "./components/EcosystemsPanel";
import { InsightsDrawer } from "./components/InsightsDrawer";
import { SettingsPanel } from "./components/SettingsPanel";
import { SideRail, type RailSection } from "./components/SideRail";
import { TopicGraph } from "./components/TopicGraph";
import { StatusBar } from "./components/StatusBar";
import { getConfig } from "./utils/config";
import { findNode, collectGeoNodes } from "./utils/topicParser";
import { registerWebMcpTools, unregisterWebMcpTools } from "./services/webMcpService";
import { getTag, TAG_REGISTRY, type InsightsTab } from "./utils/tagRegistry";
import { loadSavedSettings, persistSettings } from "./utils/settingsStorage";
import type { GeoMetadata, GeoNode } from "./types/payloadTags";
import type { SparkplugMetadata } from "./types/sparkplug";

/** State for the Insights section — tracks which topic is shown and what content is available. */
interface InsightsState {
  topicPath: string;
  geo: GeoMetadata | null;
  imageBlobUrl: string | null;
  sparkplug: SparkplugMetadata | null;
  activeTab: InsightsTab;
}

/** Left rail section identifiers. */
type LeftSection = "connection" | "settings";
/** Right rail section identifiers. */
type RightSection = "detail" | "insights" | "ecosystems";

/**
 * Pick the insights tab to show: keep the current tab when its content is still
 * available, otherwise fall back to the first available tab in registry order.
 */
function resolveInsightsTab(
  current: InsightsTab,
  available: { geo: boolean; image: boolean; sparkplug: boolean },
): InsightsTab {
  const tabHasContent: Record<InsightsTab, boolean> = {
    map: available.geo,
    image: available.image,
    device: available.sparkplug,
  };
  if (tabHasContent[current]) return current;
  for (const def of TAG_REGISTRY) {
    if (def.drawerTab && tabHasContent[def.drawerTab]) return def.drawerTab;
  }
  return current;
}

function App() {
  const { connect, disconnect, connectionStatus } = useMqttClient();
  const errorMessage = useTopicStore((s) => s.errorMessage);
  const selectedNodeId = useTopicStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useTopicStore((s) => s.setSelectedNodeId);
  const graphNodes = useTopicStore((s) => s.graphNodes);
  const autoconnectFired = useRef(false);
  const entities = useDomainEntities();

  // Rail state — one expanded section per side, null = collapsed.
  // The left rail honours the previously persisted connection-collapsed flag.
  const [leftActive, setLeftActive] = useState<LeftSection | null>(() => {
    const collapsed =
      loadSavedSettings().connectionCollapsed ?? getConfig().connectionCollapsed ?? false;
    return collapsed ? null : "connection";
  });
  const [rightActive, setRightActive] = useState<RightSection | null>(null);

  const handleLeftSelect = useCallback((id: LeftSection | null) => {
    setLeftActive(id);
    persistSettings({ connectionCollapsed: id !== "connection" });
  }, []);

  // Insights section state
  const [insightsState, setInsightsState] = useState<InsightsState | null>(null);
  const [isInsightsPinned, setIsInsightsPinned] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"single" | "all">("single");
  const [geoNavIndex, setGeoNavIndex] = useState(0);

  // Collect all geo-tagged nodes from the topic tree.
  // Recalculated on every graph rebuild (graphNodes reference changes).
  const geoNodes: GeoNode[] = useMemo(() => {
    const root = useTopicStore.getState().root;
    return collectGeoNodes(root);
  }, [graphNodes]);

  /** Open the insights section on a given tab for the selected node. */
  const openInsightsForSelected = useCallback((activeTab: InsightsTab) => {
    if (!selectedNodeId) return;
    const root = useTopicStore.getState().root;
    const segments = selectedNodeId === "" ? [] : selectedNodeId.split("/");
    const node = findNode(root, segments);
    setInsightsState({
      topicPath: selectedNodeId,
      geo: getTag(node?.payloadTags, "geo")?.metadata ?? null,
      imageBlobUrl: node?.lastImageBlobUrl ?? null,
      sparkplug: getTag(node?.payloadTags, "sparkplug")?.metadata ?? null,
      activeTab,
    });
    setDrawerMode("single");
    setRightActive("insights");
  }, [selectedNodeId]);

  /** Open the insights section to show a geo map for the selected node. */
  const handleOpenInsights = useCallback(
    () => openInsightsForSelected("map"),
    [openInsightsForSelected],
  );

  /** Open the insights section to show an image preview for the selected node. */
  const handleOpenInsightsImage = useCallback(
    () => openInsightsForSelected("image"),
    [openInsightsForSelected],
  );

  /** Open the insights section to show sparkplug device metrics for the selected node. */
  const handleOpenInsightsDevice = useCallback(
    () => openInsightsForSelected("device"),
    [openInsightsForSelected],
  );

  const handleCloseInsights = useCallback(() => {
    setInsightsState(null);
    setIsInsightsPinned(false);
    setDrawerMode("single");
  }, []);

  const handleTogglePin = useCallback(() => {
    setIsInsightsPinned((prev) => !prev);
  }, []);

  const handleSetMode = useCallback((mode: "single" | "all") => {
    if (mode === "all") {
      // Switching to all-geo mode — unpin since pinning is single-topic only
      setIsInsightsPinned(false);
    }
    setDrawerMode(mode);
  }, []);

  const handleNavigate = useCallback((index: number) => {
    if (index < 0 || index >= geoNodes.length) return;
    setGeoNavIndex(index);
    const target = geoNodes[index];
    // In single-topic mode, navigating switches the viewed topic.
    // Look up full node to get image blob URL too.
    const root = useTopicStore.getState().root;
    const segments = target.topicPath === "" ? [] : target.topicPath.split("/");
    const node = findNode(root, segments);
    setInsightsState((prev) => ({
      topicPath: target.topicPath,
      geo: target.geo,
      imageBlobUrl: node?.lastImageBlobUrl ?? null,
      sparkplug: getTag(node?.payloadTags, "sparkplug")?.metadata ?? null,
      activeTab: prev?.activeTab ?? "map",
    }));
    // Navigating while pinned unpins — the user clearly wants a different topic
    setIsInsightsPinned(false);
  }, [geoNodes]);

  /** Switch the active tab in the insights section. */
  const handleSetInsightsTab = useCallback((tab: InsightsTab) => {
    setInsightsState((prev) => prev ? { ...prev, activeTab: tab } : null);
  }, []);

  // Sync geoNavIndex when the insights topic changes (e.g. opening from DetailPanel)
  useEffect(() => {
    if (!insightsState) return;
    const idx = geoNodes.findIndex((n) => n.topicPath === insightsState.topicPath);
    if (idx >= 0) setGeoNavIndex(idx);
  }, [insightsState, geoNodes]);

  // Close insights (and unpin) on disconnect — the topic tree is
  // about to be cleared so the pinned map would show stale data.
  useEffect(() => {
    if (connectionStatus === "disconnected" && insightsState) {
      setInsightsState(null);
      setIsInsightsPinned(false);
      setDrawerMode("single");
    }
  }, [connectionStatus, insightsState]);

  // Selecting a node drives the right rail: nodes with detected insight
  // content (geo, image, sparkplug) activate the Insights section on the
  // appropriate tab (the previous drawer auto-open behaviour); nodes without
  // activate the Topic section. Deselecting collapses both. When pinned or
  // in all-geo mode, the insights content stays as-is regardless of selection.
  // Note: the image tab keys off lastImageBlobUrl, not the image tag — a
  // node whose blob was evicted (LRU) won't auto-open until a new image
  // message arrives.
  useEffect(() => {
    if (isInsightsPinned) return; // pinned — ignore node selection changes
    if (drawerMode === "all") return; // all-geo mode — ignore node selection changes

    if (!selectedNodeId) {
      setInsightsState(null);
      setRightActive((prev) =>
        prev === "detail" || prev === "insights" ? null : prev,
      );
      return;
    }

    // Look up the newly selected node's topic data
    const root = useTopicStore.getState().root;
    const segments = selectedNodeId === "" ? [] : selectedNodeId.split("/");
    const node = findNode(root, segments);
    const newGeo = getTag(node?.payloadTags, "geo")?.metadata ?? null;
    const newImage = node?.lastImageBlobUrl ?? null;
    const newSparkplug = getTag(node?.payloadTags, "sparkplug")?.metadata ?? null;

    if (newGeo || newImage || newSparkplug) {
      // Keep the current tab when it still has content; otherwise fall back
      // to the first available tab (registry order).
      setInsightsState((prev) => ({
        topicPath: selectedNodeId,
        geo: newGeo,
        imageBlobUrl: newImage,
        sparkplug: newSparkplug,
        activeTab: resolveInsightsTab(prev?.activeTab ?? "map", {
          geo: newGeo !== null,
          image: newImage !== null,
          sparkplug: newSparkplug !== null,
        }),
      }));
      setRightActive("insights");
    } else {
      // New node has no insight content — show the plain topic detail
      setInsightsState(null);
      setRightActive("detail");
    }
  }, [selectedNodeId, isInsightsPinned, drawerMode]);

  // Look up the selected node's data for the topic detail section
  const selectedNodes = useMemo(() => {
    if (!selectedNodeId) return null;
    const root = useTopicStore.getState().root;
    const segments = selectedNodeId === "" ? [] : selectedNodeId.split("/");
    const topicNode = findNode(root, segments);
    const graphNode = graphNodes.find((n) => n.id === selectedNodeId);
    if (!topicNode || !graphNode) return null;
    return { topicNode, graphNode };
  }, [selectedNodeId, graphNodes]);

  // Collapse a right-rail section whose content disappeared
  // (deselect, insights closed, entities cleared on disconnect).
  useEffect(() => {
    setRightActive((prev) => {
      if (prev === "detail" && !selectedNodes) return null;
      if (prev === "insights" && !insightsState) return null;
      if (prev === "ecosystems" && entities.length === 0) return null;
      return prev;
    });
  }, [selectedNodes, insightsState, entities.length]);

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

  const connectionDotClass =
    connectionStatus === "connected"
      ? "bg-emerald-500"
      : connectionStatus === "connecting"
        ? "bg-amber-500 animate-pulse"
        : connectionStatus === "error"
          ? "bg-red-500"
          : "bg-gray-600";

  const leftSections: RailSection<LeftSection>[] = [
    {
      id: "connection",
      title: "Connection",
      dotClass: connectionDotClass,
      icon: (
        // Signal/broadcast icon
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 010-5.304m5.304 0a3.75 3.75 0 010 5.304m-7.425 2.121a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        </svg>
      ),
      content: (
        <ConnectionPanel
          onConnect={connect}
          onDisconnect={disconnect}
          connectionStatus={connectionStatus}
          errorMessage={errorMessage}
        />
      ),
    },
    {
      id: "settings",
      title: "Settings",
      icon: (
        // Cog icon
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      content: <SettingsPanel />,
    },
  ];

  const rightSections: RailSection<RightSection>[] = [
    {
      id: "detail",
      title: "Topic",
      disabled: !selectedNodes,
      icon: (
        // Information circle icon
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
        </svg>
      ),
      content: selectedNodes ? (
        <DetailPanel
          topicNode={selectedNodes.topicNode}
          graphNode={selectedNodes.graphNode}
          onClose={() => setSelectedNodeId(null)}
          onOpenInsights={handleOpenInsights}
          onOpenInsightsImage={handleOpenInsightsImage}
          onOpenInsightsDevice={handleOpenInsightsDevice}
        />
      ) : null,
    },
    {
      id: "insights",
      title: "Insights",
      disabled: !insightsState,
      icon: (
        // Sparkles icon
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
        </svg>
      ),
      content: insightsState ? (
        <InsightsDrawer
          topicPath={insightsState.topicPath}
          geo={insightsState.geo}
          imageBlobUrl={insightsState.imageBlobUrl}
          sparkplug={insightsState.sparkplug}
          activeTab={insightsState.activeTab}
          onSetTab={handleSetInsightsTab}
          isPinned={isInsightsPinned}
          onTogglePin={handleTogglePin}
          mode={drawerMode}
          onSetMode={handleSetMode}
          geoNodes={geoNodes}
          geoNavIndex={geoNavIndex}
          onNavigate={handleNavigate}
          onClose={handleCloseInsights}
        />
      ) : null,
    },
    {
      id: "ecosystems",
      title: "Ecosystems",
      disabled: entities.length === 0,
      badge: entities.length,
      icon: (
        // CPU chip icon
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M15.75 3v1.5M8.25 19.5V21M15.75 19.5V21M3 8.25h1.5M3 15.75h1.5M19.5 8.25H21M19.5 15.75H21M7.5 6h9A1.5 1.5 0 0 1 18 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 16.5v-9A1.5 1.5 0 0 1 7.5 6Z" />
        </svg>
      ),
      content: <EcosystemsPanel entities={entities} />,
    },
  ];

  return (
    <div className="relative w-full h-screen bg-slate-900">
      <TopicGraph />
      <SideRail
        side="left"
        sections={leftSections}
        activeId={leftActive}
        onSelect={handleLeftSelect}
        footer={
          <a
            href="https://github.com/ryanbateman/mqtt_vis"
            target="_blank"
            rel="noopener noreferrer"
            className="block p-2 text-gray-600 hover:text-gray-400 transition-colors"
            title="View on GitHub"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
            </svg>
          </a>
        }
      />
      <SideRail
        side="right"
        sections={rightSections}
        activeId={rightActive}
        onSelect={setRightActive}
      />
      <StatusBar />
    </div>
  );
}

export default App;
