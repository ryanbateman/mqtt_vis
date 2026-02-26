import { useState, useCallback, useMemo, type FormEvent } from "react";
import type { ConnectionParams, ConnectionStatus } from "../types";
import { loadSavedConnection } from "../hooks/useMqttClient";

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

export function ConnectionPanel({
  onConnect,
  onDisconnect,
  connectionStatus,
  errorMessage,
}: ConnectionPanelProps) {
  const saved = loadSavedConnection();

  const [brokerUrl, setBrokerUrl] = useState(saved.brokerUrl ?? "wss://broker.hivemq.com:8884/mqtt");
  const [topicFilter, setTopicFilter] = useState(saved.topicFilter ?? "robot/#");
  const [username, setUsername] = useState(saved.username ?? "");
  const [password, setPassword] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  const [clearOnDisconnect, setClearOnDisconnect] = useState(false);

  // Client ID: random by default, optionally user-defined
  const defaultClientId = useMemo(() => generateClientId(), []);
  const [customClientId, setCustomClientId] = useState(saved.customClientId ?? false);
  const [clientId, setClientId] = useState(
    saved.customClientId && saved.clientId ? saved.clientId : defaultClientId
  );

  const isConnected = connectionStatus === "connected";
  const isConnecting = connectionStatus === "connecting";

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
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
        <span className="text-sm font-medium text-gray-300">{statusLabel}</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
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
          </div>
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={!customClientId || isConnected || isConnecting}
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
            checked={clearOnDisconnect}
            onChange={(e) => setClearOnDisconnect(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer accent-blue-500"
          />
          <span className="text-xs text-gray-400">Clear graph on disconnect</span>
        </label>
      </form>

      {errorMessage && (
        <p className="mt-2 text-xs text-red-400">{errorMessage}</p>
      )}
    </div>
  );
}
