import mqtt, { type MqttClient, type IClientOptions } from "mqtt";
import type { ConnectionParams } from "../types";

export type MessageHandler = (topic: string, payload: Buffer, qos: 0 | 1 | 2) => void;
export type StatusHandler = (status: "connecting" | "connected" | "disconnected" | "error", error?: Error) => void;

/**
 * Thin wrapper around mqtt.js for browser WebSocket connections.
 * Manages a single client instance with connect/disconnect lifecycle.
 */
export class MqttService {
  private client: MqttClient | null = null;
  private onMessage: MessageHandler | null = null;
  private onStatus: StatusHandler | null = null;

  /** Register a callback for incoming messages. */
  setMessageHandler(handler: MessageHandler): void {
    this.onMessage = handler;
  }

  /** Register a callback for connection status changes. */
  setStatusHandler(handler: StatusHandler): void {
    this.onStatus = handler;
  }

  /** Connect to an MQTT broker and subscribe to the given topic filter. */
  connect(params: ConnectionParams): void {
    this.disconnect();

    this.onStatus?.("connecting");

    const options: IClientOptions = {
      clean: true,
      connectTimeout: 10_000,
      reconnectPeriod: 5_000,
    };

    if (params.username) {
      options.username = params.username;
    }
    if (params.password) {
      options.password = params.password;
    }

    this.client = mqtt.connect(params.brokerUrl, options);

    this.client.on("connect", () => {
      this.onStatus?.("connected");
      this.client?.subscribe(params.topicFilter, { qos: 0 }, (err) => {
        if (err) {
          console.error("MQTT subscribe error:", err);
          this.onStatus?.("error", err);
        }
      });
    });

    this.client.on("message", (topic, payload, packet) => {
      this.onMessage?.(topic, payload, packet.qos as 0 | 1 | 2);
    });

    this.client.on("error", (err) => {
      console.error("MQTT error:", err);
      this.onStatus?.("error", err);
    });

    this.client.on("close", () => {
      this.onStatus?.("disconnected");
    });

    this.client.on("reconnect", () => {
      this.onStatus?.("connecting");
    });
  }

  /** Disconnect from the broker and clean up. */
  disconnect(): void {
    if (this.client) {
      this.client.removeAllListeners();
      this.client.end(true);
      this.client = null;
    }
  }

  /** Whether the client is currently connected. */
  get isConnected(): boolean {
    return this.client?.connected ?? false;
  }
}

/** Singleton MQTT service instance. */
export const mqttService = new MqttService();
