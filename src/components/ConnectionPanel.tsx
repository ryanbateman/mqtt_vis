import { useState, useCallback, useMemo, type FormEvent } from "react";
import type { ConnectionParams, ConnectionStatus } from "../types";
import { loadSavedConnection } from "../hooks/useMqttClient";
import { getConfig } from "../utils/config";

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

export function ConnectionPanel({
  onConnect,
  onDisconnect,
  connectionStatus,
  errorMessage,
}: ConnectionPanelProps) {
  const cfg = getConfig();
  const saved = loadSavedConnection();
  const urlParams = useMemo(() => getUrlParams(), []);

  const [collapsed, setCollapsed] = useState(cfg.connectionCollapsed ?? false);
  const [brokerUrl, setBrokerUrl] = useState(urlParams.broker ?? saved.brokerUrl ?? cfg.brokerUrl ?? "wss://broker.hivemq.com:8884/mqtt");
  const [topicFilter, setTopicFilter] = useState(urlParams.topic ?? saved.topicFilter ?? cfg.topicFilter ?? "robot/#");
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
    // Clear any existing params and set only broker + topic
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

  const statusLabel =
    connectionStatus === "connected"
      ? "Connected"
      : connectionStatus === "connecting"
        ? "Connecting..."
        : connectionStatus === "error"
          ? "Error"
          : "Disconnected";

  return (
    <div className="absolute top-4 left-4 z-10 bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg p-4 shadow-xl w-80">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
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
        <div className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
        <span className="text-sm font-medium text-gray-300">{statusLabel}</span>
      </button>

      {!collapsed && (
        <>
          <form onSubmit={handleSubmit} className="space-y-3 mt-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Broker URL
              </label>
              <input
                type="text"
                value={brokerUrl}
                onChange={(e) => setBrokerUrl(e.target.value)}
                disabled={isConnected || isConnecting}
                placeholder="ws://localhost:9001"
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
                disabled={isConnected || isConnecting}
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
                      isConnected || isConnecting
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
                      disabled={isConnected || isConnecting}
                      className="w-3 h-3 rounded border-gray-600 bg-gray-800 text-blue-500 accent-blue-500 cursor-pointer disabled:cursor-not-allowed"
                    />
                  </label>
                )}
              </div>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                disabled={configForcesClientId || !customClientId || isConnected || isConnecting}
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
                  disabled={isConnected || isConnecting}
                  placeholder="Username (optional)"
                  className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isConnected || isConnecting}
                  placeholder="Password (optional)"
                  className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
              </div>
            )}

            <button
              type="submit"
              className={`w-full py-2 rounded text-sm font-medium transition-colors ${
                isConnected || isConnecting
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              {isConnected || isConnecting ? "Disconnect" : "Connect"}
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
          </form>

          {errorMessage && (
            <p className="mt-2 text-xs text-red-400">{errorMessage}</p>
          )}
        </>
      )}

      <div className="flex justify-between items-center mt-3">
        <span className="text-[10px] text-gray-600">v{__APP_VERSION__}</span>
        <span className="text-[10px] text-gray-600">
          Created by{" "}
          <a
            href="https://github.com/ryanbateman"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            Ryan Bateman
          </a>
        </span>
      </div>
    </div>
  );
}
