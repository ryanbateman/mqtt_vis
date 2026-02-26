import { useEffect, useCallback, useRef } from "react";
import { mqttService } from "../services/mqttService";
import { useTopicStore, startDecayTimer } from "../stores/topicStore";
import type { ConnectionParams } from "../types";

/**
 * Hook to manage the MQTT client lifecycle.
 * Connects/disconnects, routes messages to the store, and manages the decay timer.
 */
export function useMqttClient() {
  const handleMessage = useTopicStore((s) => s.handleMessage);
  const setConnectionStatus = useTopicStore((s) => s.setConnectionStatus);
  const reset = useTopicStore((s) => s.reset);
  const connectionStatus = useTopicStore((s) => s.connectionStatus);
  const decayCleanup = useRef<(() => void) | null>(null);

  // Set up message and status handlers
  useEffect(() => {
    mqttService.setMessageHandler((topic, payload, qos) => {
      const payloadStr = payload.toString();
      handleMessage(topic, payloadStr, qos);
    });

    mqttService.setStatusHandler((status, error) => {
      setConnectionStatus(status, error?.message);
    });
  }, [handleMessage, setConnectionStatus]);

  const connect = useCallback(
    (params: ConnectionParams) => {
      reset();
      useTopicStore.getState().setTopicFilter(params.topicFilter);
      mqttService.connect(params);

      // Start the decay timer
      if (decayCleanup.current) {
        decayCleanup.current();
      }
      decayCleanup.current = startDecayTimer();

      // Persist connection params to localStorage
      try {
        localStorage.setItem(
          "mqtt_connection",
          JSON.stringify({
            brokerUrl: params.brokerUrl,
            topicFilter: params.topicFilter,
            clientId: params.clientId,
            username: params.username,
          })
        );
      } catch {
        // localStorage may not be available
      }
    },
    [reset]
  );

  const disconnect = useCallback(
    (clear?: boolean) => {
      mqttService.disconnect();
      setConnectionStatus("disconnected");

      if (decayCleanup.current) {
        decayCleanup.current();
        decayCleanup.current = null;
      }

      if (clear) {
        reset();
      }
    },
    [setConnectionStatus, reset]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mqttService.disconnect();
      if (decayCleanup.current) {
        decayCleanup.current();
      }
    };
  }, []);

  return { connect, disconnect, connectionStatus };
}

/** Saved connection data includes ConnectionParams fields plus UI-only state. */
export type SavedConnection = Partial<ConnectionParams> & {
  customClientId?: boolean;
};

/**
 * Load previously saved connection params from localStorage.
 */
export function loadSavedConnection(): SavedConnection {
  try {
    const saved = localStorage.getItem("mqtt_connection");
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // ignore parse errors
  }
  return {};
}
