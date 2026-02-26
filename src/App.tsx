import { useMqttClient } from "./hooks/useMqttClient";
import { useTopicStore } from "./stores/topicStore";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { TopicGraph } from "./components/TopicGraph";
import { StatusBar } from "./components/StatusBar";
import { SettingsPanel } from "./components/SettingsPanel";

function App() {
  const { connect, disconnect, connectionStatus } = useMqttClient();
  const errorMessage = useTopicStore((s) => s.errorMessage);

  return (
    <div className="relative w-full h-screen bg-slate-900">
      <TopicGraph />
      <ConnectionPanel
        onConnect={connect}
        onDisconnect={disconnect}
        connectionStatus={connectionStatus}
        errorMessage={errorMessage}
      />
      <SettingsPanel />
      <StatusBar />
    </div>
  );
}

export default App;
