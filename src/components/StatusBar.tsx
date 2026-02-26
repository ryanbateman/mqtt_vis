import { useEffect, useState } from "react";
import { useTopicStore } from "../stores/topicStore";

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function StatusBar() {
  const totalMessages = useTopicStore((s) => s.totalMessages);
  const totalTopics = useTopicStore((s) => s.totalTopics);
  const connectionStatus = useTopicStore((s) => s.connectionStatus);
  const sessionStart = useTopicStore((s) => s.sessionStart);
  const [uptime, setUptime] = useState("0s");

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
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg px-6 py-2 shadow-xl flex items-center gap-6 text-sm">
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
  );
}
