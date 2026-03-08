import { useState, useCallback, useMemo, useEffect, type FormEvent } from "react";
import type { ConnectionParams, ConnectionStatus } from "../types";
import { loadSavedConnection } from "../hooks/useMqttClient";
import { getConfig } from "../utils/config";
import { getBrokerIcon, CUSTOM_BROKER_ICON } from "../utils/brokerIcons";
import { loadSavedSettings, persistSettings } from "../utils/settingsStorage";
import { useTopicStore } from "../stores/topicStore";
import { mqttService } from "../services/mqttService";
import { formatLogTimestamp } from "../utils/connectionErrors";
import { SliderRow, InfoTooltip } from "./SettingsPanel";

/** Sentinel value used as the <select> value for the Custom Broker option. */
const CUSTOM_BROKER = "__custom__";

/** Generate a random client ID with a recognisable prefix. */
function generateClientId(): string {
  return "mqtt_visualiser_" + Math.random().toString(16).slice(2, 10);
}

interface ConnectionPanelProps {
  onConnect: (params: ConnectionParams) => void;
  onDisconnect: (clear?: boolean) => void;
  connectionStatus: ConnectionStatus;
  errorMessage: string | null;
}

/** Read URL query params once on load (highest precedence for broker/topic). */
function getUrlParams(): { broker?: string; topic?: string } {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      broker: params.get("broker") ?? undefined,
      topic: params.get("topic") ?? undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Derive initial broker URL and dropdown selection from the precedence chain:
 *   URL param > localStorage > config brokers[0] > empty
 *
 * Returns:
 *   brokerUrl      — the URL to populate in the input field
 *   dropdownValue  — the <select> value (a known broker URL or CUSTOM_BROKER)
 *   customBrokerUrl — the URL to restore when the user picks "Custom Broker"
 */
function deriveInitialBrokerState(
  urlParamBroker: string | undefined,
  savedBrokerUrl: string | undefined,
  configBrokers: { url: string }[]
): { brokerUrl: string; dropdownValue: string; customBrokerUrl: string } {
  const knownUrls = new Set(configBrokers.map((b) => b.url));

  // URL param overrides everything
  if (urlParamBroker) {
    const dropdownValue = knownUrls.has(urlParamBroker)
      ? urlParamBroker
      : CUSTOM_BROKER;
    return {
      brokerUrl: urlParamBroker,
      dropdownValue,
      customBrokerUrl: knownUrls.has(urlParamBroker) ? "" : urlParamBroker,
    };
  }

  // Returning visitor: restore from localStorage
  if (savedBrokerUrl) {
    const dropdownValue = knownUrls.has(savedBrokerUrl)
      ? savedBrokerUrl
      : CUSTOM_BROKER;
    return {
      brokerUrl: savedBrokerUrl,
      dropdownValue,
      customBrokerUrl: knownUrls.has(savedBrokerUrl) ? "" : savedBrokerUrl,
    };
  }

  // First-time visitor: use first broker in config list
  if (configBrokers.length > 0) {
    return {
      brokerUrl: configBrokers[0].url,
      dropdownValue: configBrokers[0].url,
      customBrokerUrl: "",
    };
  }

  // No brokers configured at all
  return { brokerUrl: "", dropdownValue: CUSTOM_BROKER, customBrokerUrl: "" };
}

export function ConnectionPanel({
  onConnect,
  onDisconnect,
  connectionStatus,
  errorMessage,
}: ConnectionPanelProps) {
  const cfg = getConfig();
  const saved = loadSavedConnection();
  const savedSettings = loadSavedSettings();
  const urlParams = useMemo(() => getUrlParams(), []);

  const brokers = cfg.brokers ?? [];

  // Derive initial state once
  const initialBrokerState = useMemo(
    () => deriveInitialBrokerState(urlParams.broker, saved.brokerUrl, brokers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [collapsed, setCollapsed] = useState(
    savedSettings.connectionCollapsed ?? cfg.connectionCollapsed ?? false
  );
  const [activeTab, setActiveTab] = useState<"connect" | "filter" | "log">("connect");
  const selectedNodeId = useTopicStore((s) => s.selectedNodeId);
  const dropRetainedBurst = useTopicStore((s) => s.dropRetainedBurst);
  const setDropRetainedBurst = useTopicStore((s) => s.setDropRetainedBurst);
  const burstWindowActive = useTopicStore((s) => s.burstWindowActive);
  const burstSettingsLocked = useTopicStore((s) => s.burstSettingsLocked);
  const burstWindowDuration = useTopicStore((s) => s.burstWindowDuration);
  const setBurstWindowDuration = useTopicStore((s) => s.setBurstWindowDuration);
  const pruneTimeout = useTopicStore((s) => s.pruneTimeout);
  const setPruneTimeout = useTopicStore((s) => s.setPruneTimeout);

  // Auto-collapse when a node is selected (to make room for the DetailPanel).
  // Deselecting does NOT re-expand — the user can manually expand if they want.
  useEffect(() => {
    if (selectedNodeId !== null) {
      setCollapsed(true);
    }
  }, [selectedNodeId]);

  // Auto-switch to Log tab when an error message arrives so the user sees it.
  useEffect(() => {
    if (errorMessage) {
      setActiveTab("log");
    }
  }, [errorMessage]);

  const [brokerUrl, setBrokerUrl] = useState(initialBrokerState.brokerUrl);
  const [dropdownValue, setDropdownValue] = useState(initialBrokerState.dropdownValue);
  // The last custom URL the user typed/used — restored when they pick "Custom Broker"
  const [customBrokerUrl, setCustomBrokerUrl] = useState(initialBrokerState.customBrokerUrl);

  const [topicFilter, setTopicFilter] = useState(
    urlParams.topic ?? saved.topicFilter ?? cfg.topicFilter ?? ""
  );
  const [username, setUsername] = useState(saved.username ?? cfg.username ?? "");
  const [password, setPassword] = useState(cfg.password ?? "");
  const [showAuth, setShowAuth] = useState(false);
  const [clearOnDisconnect, setClearOnDisconnect] = useState(false);
  const [autoconnect, setAutoconnect] = useState(saved.autoconnect ?? cfg.autoconnect ?? false);
  const [copied, setCopied] = useState(false);

  // Client ID: config can force a fixed ID, otherwise random by default
  const configForcesClientId = typeof cfg.clientId === "string" && cfg.clientId.length > 0;
  const defaultClientId = useMemo(() => generateClientId(), []);
  const [customClientId, setCustomClientId] = useState(
    configForcesClientId ? true : (saved.customClientId ?? false)
  );
  const [clientId, setClientId] = useState(() => {
    if (configForcesClientId) return cfg.clientId as string;
    if (saved.customClientId && saved.clientId) return saved.clientId;
    return defaultClientId;
  });

  const isConnected = connectionStatus === "connected";
  const isConnecting = connectionStatus === "connecting";

  /** Cancel any in-progress reconnect loop when the user focuses a connection field. */
  const cancelReconnect = useCallback(() => {
    if (isConnecting) onDisconnect();
  }, [isConnecting, onDisconnect]);

  const knownBrokerUrls = useMemo(() => new Set(brokers.map((b) => b.url)), [brokers]);

  /** Handle dropdown selection changes. */
  const handleDropdownChange = useCallback((value: string) => {
    if (value === CUSTOM_BROKER) {
      // Restore the last custom URL (may be empty on first visit)
      setBrokerUrl(customBrokerUrl);
      setDropdownValue(CUSTOM_BROKER);
    } else {
      // Known broker selected
      setBrokerUrl(value);
      setDropdownValue(value);
    }
  }, [customBrokerUrl]);

  /** Handle manual edits to the Broker URL input. */
  const handleBrokerUrlChange = useCallback((newUrl: string) => {
    setBrokerUrl(newUrl);
    if (knownBrokerUrls.has(newUrl)) {
      // Typed URL exactly matches a known broker — sync the dropdown
      setDropdownValue(newUrl);
    } else {
      // Non-matching URL — switch to Custom Broker and remember it
      setDropdownValue(CUSTOM_BROKER);
      setCustomBrokerUrl(newUrl);
    }
  }, [knownBrokerUrls]);

  /** Persist the autoconnect preference to localStorage. */
  const persistAutoconnect = useCallback((value: boolean) => {
    try {
      const raw = localStorage.getItem("mqtt_connection");
      const data = raw ? JSON.parse(raw) : {};
      data.autoconnect = value;
      localStorage.setItem("mqtt_connection", JSON.stringify(data));
    } catch { /* ignore */ }
  }, []);

  const handleCopyShareLink = useCallback(() => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("broker", brokerUrl);
    url.searchParams.set("topic", topicFilter);
    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      // Clipboard API may fail in insecure contexts — ignore silently
    });
  }, [brokerUrl, topicFilter]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (isConnected || isConnecting) {
        onDisconnect(clearOnDisconnect);
      } else {
        onConnect({
          brokerUrl,
          topicFilter,
          clientId,
          username: username || undefined,
          password: password || undefined,
        });
      }
    },
    [brokerUrl, topicFilter, clientId, username, password, isConnected, isConnecting, onConnect, onDisconnect, clearOnDisconnect]
  );

  const statusColor =
    connectionStatus === "connected"
      ? "bg-emerald-500"
      : connectionStatus === "connecting"
        ? "bg-amber-500 animate-pulse"
        : connectionStatus === "error"
          ? "bg-red-500"
          : "bg-gray-500";

  // Reconnect attempt count — read live from the service on each render.
  const reconnectAttempts = mqttService.reconnectAttempts;

  // Button label and colour reflect the current connection state.
  const buttonLabel =
    connectionStatus === "connected"
      ? "Disconnect"
      : connectionStatus === "connecting"
        ? reconnectAttempts > 0
          ? `Reconnecting (${reconnectAttempts}/3)…`
          : "Connecting…"
        : "Connect";

  const buttonClass =
    connectionStatus === "connected"
      ? "bg-red-600 hover:bg-red-700 text-white"
      : connectionStatus === "connecting"
        ? "bg-amber-600 hover:bg-amber-700 text-white animate-pulse"
        : "bg-blue-600 hover:bg-blue-700 text-white";

  // Icon reflects the currently selected broker (custom = pencil icon, known = brand icon)
  const brokerIcon =
    dropdownValue === CUSTOM_BROKER
      ? CUSTOM_BROKER_ICON
      : getBrokerIcon(dropdownValue);

  // Description: undefined/null → default; "" → hidden; string → use as-is
  const DEFAULT_DESCRIPTION =
    "Discover, monitor, and understand your MQTT traffic in real time. " +
    "See which topics are active, how fast they publish, and how your topic tree is structured.";
  const panelDescription =
    cfg.description === ""
      ? null
      : (cfg.description ?? DEFAULT_DESCRIPTION);

  return (
    <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg p-4 shadow-xl w-80">
      <button
        type="button"
        onClick={() => {
          const next = !collapsed;
          setCollapsed(next);
          persistSettings({ connectionCollapsed: next });
        }}
        className="flex items-center gap-2 w-full hover:opacity-80 transition-opacity"
      >
        <svg
          className={`w-3 h-3 text-gray-400 transition-transform ${collapsed ? "" : "rotate-90"}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
            clipRule="evenodd"
          />
        </svg>
        <span className="text-sm font-semibold text-gray-200">MQTT Visualiser</span>
        {/* Error hint visible even when panel is collapsed */}
        {collapsed && errorMessage && connectionStatus === "error" && (
          <span className="ml-2 text-[10px] text-red-400 truncate max-w-[100px]" title={errorMessage}>
            {errorMessage}
          </span>
        )}
        <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
          {burstWindowActive && (
            <svg
              className="w-3 h-3 text-amber-400 animate-pulse"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <title>Dropping retained messages — burst window active</title>
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                clipRule="evenodd"
              />
            </svg>
          )}
          <div className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
        </div>
      </button>

      {/* Animated collapsible body — always mounted, grid-row collapses to 0fr */}
      <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${
        collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
      }`}>
        <div className="overflow-hidden">
          <>
            {/* Description */}
            {panelDescription && (
              <p className="text-[11px] text-gray-500 leading-snug mt-1.5 mb-0">
                {panelDescription}
              </p>
            )}
          {/* Tab bar */}
          <div className="flex gap-4 border-b border-gray-700 mt-3 mb-3">
            <button
              type="button"
              onClick={() => setActiveTab("connect")}
              className={`pb-1.5 text-xs font-medium transition-colors ${
                activeTab === "connect"
                  ? "text-blue-400 border-b-2 border-blue-400 -mb-px"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Connect
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("filter")}
              className={`pb-1.5 text-xs font-medium transition-colors ${
                activeTab === "filter"
                  ? "text-blue-400 border-b-2 border-blue-400 -mb-px"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Filter
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("log")}
              className={`pb-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === "log"
                  ? "text-blue-400 border-b-2 border-blue-400 -mb-px"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Log
              {/* Red dot badge when there's an error and the user is not on the Log tab */}
              {errorMessage && activeTab !== "log" && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
              )}
            </button>
          </div>

          {/* Connect tab */}
          {activeTab === "connect" && (
            <form onSubmit={handleSubmit} className="space-y-3">

              {/* Quick Connect dropdown — always shown when brokers list is non-empty */}
              {brokers.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Quick Connect
                  </label>
                  <div className="flex items-center gap-2">
                    <svg
                      className="w-5 h-5 flex-shrink-0"
                      viewBox="0 0 24 24"
                      fill={brokerIcon.color}
                      role="img"
                      aria-label={brokerIcon.label}
                    >
                      <path d={brokerIcon.path} />
                    </svg>
                    <select
                      value={dropdownValue}
                      onChange={(e) => handleDropdownChange(e.target.value)}
                      onFocus={cancelReconnect}
                      disabled={isConnected}
                      className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500 disabled:opacity-50 cursor-pointer"
                    >
                      {brokers.map((broker) => (
                        <option key={broker.url} value={broker.url}>
                          {broker.name}
                        </option>
                      ))}
                      <option value={CUSTOM_BROKER}>Custom Broker</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Broker URL
                </label>
                <input
                  type="text"
                  value={brokerUrl}
                  onChange={(e) => handleBrokerUrlChange(e.target.value)}
                  onFocus={cancelReconnect}
                  disabled={isConnected}
                  placeholder="wss://broker.example.com:8884/mqtt"
                  className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Topic Filter
                </label>
                <input
                  type="text"
                  value={topicFilter}
                  onChange={(e) => setTopicFilter(e.target.value)}
                  onFocus={cancelReconnect}
                  disabled={isConnected}
                  placeholder="#"
                  className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Use # for all topics, + for single-level wildcard
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-400">
                    Client ID
                  </label>
                  {!configForcesClientId && (
                    <label
                      className={`flex items-center gap-1.5 ${
                        isConnected
                          ? "opacity-50 cursor-not-allowed"
                          : "cursor-pointer"
                      }`}
                    >
                      <span className="text-[10px] text-gray-500">Custom</span>
                      <input
                        type="checkbox"
                        checked={customClientId}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setCustomClientId(checked);
                          if (!checked) {
                            setClientId(generateClientId());
                          }
                          // Persist the toggle state to localStorage
                          try {
                            const raw = localStorage.getItem("mqtt_connection");
                            const data = raw ? JSON.parse(raw) : {};
                            data.customClientId = checked;
                            localStorage.setItem("mqtt_connection", JSON.stringify(data));
                          } catch { /* ignore */ }
                        }}
                        onFocus={cancelReconnect}
                        disabled={isConnected}
                        className="w-3 h-3 rounded border-gray-600 bg-gray-800 text-blue-500 accent-blue-500 cursor-pointer disabled:cursor-not-allowed"
                      />
                    </label>
                  )}
                </div>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  onFocus={cancelReconnect}
                  disabled={configForcesClientId || !customClientId || isConnected}
                  placeholder="mqtt_visualiser_..."
                  className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50 font-mono text-xs"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowAuth(!showAuth)}
                className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                {showAuth ? "Hide" : "Show"} authentication
              </button>

              {showAuth && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onFocus={cancelReconnect}
                    disabled={isConnected}
                    placeholder="Username (optional)"
                    className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={cancelReconnect}
                    disabled={isConnected}
                    placeholder="Password (optional)"
                    className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                  />
                </div>
              )}

              <button
                type="submit"
                className={`w-full py-2 rounded text-sm font-medium transition-colors ${buttonClass}`}
              >
                {buttonLabel}
              </button>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoconnect}
                  onChange={(e) => {
                    setAutoconnect(e.target.checked);
                    persistAutoconnect(e.target.checked);
                  }}
                  className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer accent-blue-500"
                />
                <span className="text-xs text-gray-400">Auto-connect on load</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearOnDisconnect}
                  onChange={(e) => setClearOnDisconnect(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer accent-blue-500"
                />
                <span className="text-xs text-gray-400">Clear graph on disconnect</span>
              </label>

              <button
                type="button"
                onClick={handleCopyShareLink}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                {copied ? "Copied!" : "Copy connection share link"}
              </button>

              <button
                type="button"
                onClick={() => useTopicStore.getState().requestExport()}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Export graph as PNG
              </button>
            </form>
          )}

          {/* Filter tab */}
          {activeTab === "filter" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className={`flex items-center gap-1.5 ${burstSettingsLocked ? "opacity-50" : ""}`}>
                  <label className="text-xs font-medium text-gray-400">
                    Drop Retained Messages
                  </label>
                  <InfoTooltip text="Completely ignore retained messages during the burst window after connecting. No nodes are created, no counters incremented. Prevents the graph from exploding with stale retained data on subscribe." />
                </div>
                <input
                  type="checkbox"
                  checked={dropRetainedBurst}
                  onChange={(e) => setDropRetainedBurst(e.target.checked)}
                  disabled={burstSettingsLocked}
                  className={`h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-blue-500 accent-blue-500 ${burstSettingsLocked ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                />
              </div>
              {dropRetainedBurst && (
                <SliderRow
                  label="Burst Window"
                  tooltip="How long after connecting to drop retained messages. Longer windows catch slower brokers with large retained sets."
                  value={burstWindowDuration / 1000}
                  displayValue={`${burstWindowDuration / 1000}s`}
                  min={5}
                  max={30}
                  step={1}
                  minLabel="5s"
                  maxLabel="30s"
                  onChange={(v) => setBurstWindowDuration(v * 1000)}
                  disabled={burstSettingsLocked}
                />
              )}
              <SliderRow
                label="Prune Idle Nodes"
                tooltip="Remove nodes that stop receiving messages after this time. Helps clear retained message clutter after initial connect."
                value={pruneTimeout === 0 ? 6 : pruneTimeout / 60_000}
                displayValue={pruneTimeout === 0 ? "Never" : `${pruneTimeout / 60_000} min`}
                min={1}
                max={6}
                step={1}
                minLabel="1 min"
                maxLabel="Never"
                onChange={(v) => setPruneTimeout(v >= 6 ? 0 : v * 60_000)}
              />
            </div>
          )}

          {/* Log tab */}
          {activeTab === "log" && (
            <div className="space-y-3">
              {/* Error message */}
              {errorMessage && (
                <p className="text-xs text-red-400 leading-snug">{errorMessage}</p>
              )}

              {/* Connection log entries */}
              {mqttService.connectionLog.length > 0 ? (
                <div className="max-h-48 overflow-y-auto rounded bg-gray-800/60 p-2 space-y-0.5">
                  {mqttService.connectionLog.map((entry, i) => (
                    <div key={i} className="flex gap-2 text-[10px] font-mono leading-snug">
                      <span className="text-gray-500 flex-shrink-0">{formatLogTimestamp(entry.timestamp)}</span>
                      <span className="text-gray-300">{entry.message}</span>
                    </div>
                  ))}
                </div>
              ) : (
                !errorMessage && (
                  <p className="text-[10px] text-gray-600 italic">No connection events yet.</p>
                )
              )}
            </div>
          )}
          </>
        </div>
      </div>

      <div className="flex justify-between items-center mt-3">
        <span className="text-[10px] text-gray-600">v{__APP_VERSION__}</span>
        <span className="flex items-center gap-1.5 text-[10px] text-gray-600">
          by
          <a
            href="https://github.com/ryanbateman"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold hover:text-gray-400 transition-colors"
          >
            Ryan Bateman
          </a>
          <img
            src="https://github.com/ryanbateman.png"
            alt="Ryan Bateman"
            className="w-4 h-4 rounded-full"
          />
        </span>
      </div>
    </div>
  );
}
