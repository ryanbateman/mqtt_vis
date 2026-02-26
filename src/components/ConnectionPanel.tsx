import { useState, useCallback, type FormEvent } from "react";
import type { ConnectionParams, ConnectionStatus } from "../types";
import { loadSavedConnection } from "../hooks/useMqttClient";

interface ConnectionPanelProps {
  onConnect: (params: ConnectionParams) => void;
  onDisconnect: () => void;
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

  const [brokerUrl, setBrokerUrl] = useState(saved.brokerUrl ?? "ws://localhost:9001");
  const [topicFilter, setTopicFilter] = useState(saved.topicFilter ?? "#");
  const [username, setUsername] = useState(saved.username ?? "");
  const [password, setPassword] = useState("");
  const [showAuth, setShowAuth] = useState(false);

  const isConnected = connectionStatus === "connected";
  const isConnecting = connectionStatus === "connecting";

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (isConnected || isConnecting) {
        onDisconnect();
      } else {
        onConnect({
          brokerUrl,
          topicFilter,
          username: username || undefined,
          password: password || undefined,
        });
      }
    },
    [brokerUrl, topicFilter, username, password, isConnected, isConnecting, onConnect, onDisconnect]
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
      </form>

      {errorMessage && (
        <p className="mt-2 text-xs text-red-400">{errorMessage}</p>
      )}
    </div>
  );
}
