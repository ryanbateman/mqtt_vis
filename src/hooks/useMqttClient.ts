import { useEffect, useCallback, useRef } from "react";
import { mqttService } from "../services/mqttService";
import { useTopicStore, startDecayTimer } from "../stores/topicStore";
import { diagnoseConnectionError } from "../utils/connectionErrors";
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
    mqttService.setMessageHandler((topic, payload, qos, retain, userProperties) => {
      // Detect image payloads from raw binary before UTF-8 decoding mangles them.
      // Buffer extends Uint8Array so we can check magic bytes directly.
      let imageBlobUrl: string | undefined;
      if (payload.length >= 4) {
        const isJpeg = payload[0] === 0xFF && payload[1] === 0xD8;
        const isPng = payload[0] === 0x89 && payload[1] === 0x50
          && payload[2] === 0x4E && payload[3] === 0x47;
        if (isJpeg || isPng) {
          const mime = isJpeg ? "image/jpeg" : "image/png";
          // Buffer (browser polyfill) may be a view into a pooled ArrayBuffer,
          // so slice out only the relevant bytes before creating the Blob.
          const bytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
          const blob = new Blob([bytes], { type: mime });
          imageBlobUrl = URL.createObjectURL(blob);
        }
      }

      const payloadStr = payload.toString();
      handleMessage(topic, payloadStr, qos, retain, userProperties, imageBlobUrl);
    });

    mqttService.setStatusHandler((status, error) => {
      const message = error
        ? diagnoseConnectionError(
            mqttService.lastBrokerUrl,
            error.message,
            error.code,
            typeof window !== "undefined" ? window.location.protocol : "https:",
          )
        : undefined;
      setConnectionStatus(status, message);
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
      // Explicitly pass empty string to signal "clear error" — setConnectionStatus
      // treats `error !== undefined` as "new error", so we pass "" to clear it
      // without ambiguity from the preserve-on-reconnect logic.
      setConnectionStatus("disconnected", "");

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
  autoconnect?: boolean;
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
