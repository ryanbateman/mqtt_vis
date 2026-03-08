import mqtt, { type MqttClient, type IClientOptions } from "mqtt";
import type { ConnectionParams } from "../types";

export type MessageHandler = (
  topic: string, payload: Buffer, qos: 0 | 1 | 2, retain: boolean,
  userProperties?: Record<string, string | string[]>,
) => void;

/** Error info passed to the status handler — richer than a bare string. */
export interface MqttStatusError {
  message: string;
  /** Node.js error code, e.g. "ECONNREFUSED", "ENOTFOUND". May be undefined. */
  code?: string;
}

export type StatusHandler = (
  status: "connecting" | "connected" | "disconnected" | "error",
  error?: MqttStatusError,
) => void;

/** A single entry in the connection event log. */
export interface ConnectionLogEntry {
  /** Unix timestamp (ms). */
  timestamp: number;
  /** Short event label shown in the log. */
  message: string;
}

/** Maximum entries kept in the connection log ring buffer. */
const MAX_LOG_ENTRIES = 20;

/** Maximum automatic reconnect attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 3;

/**
 * Thin wrapper around mqtt.js for browser WebSocket connections.
 * Manages a single client instance with connect/disconnect lifecycle,
 * a connection event log, and a capped auto-reconnect strategy.
 */
export class MqttService {
  private client: MqttClient | null = null;
  private onMessage: MessageHandler | null = null;
  private onStatus: StatusHandler | null = null;
  private _log: ConnectionLogEntry[] = [];
  private _reconnectAttempts = 0;
  private _lastBrokerUrl = "";

  /** The broker URL from the most recent connect() call. */
  get lastBrokerUrl(): string {
    return this._lastBrokerUrl;
  }

  /** Snapshot of the connection event log (oldest first). */
  get connectionLog(): readonly ConnectionLogEntry[] {
    return this._log;
  }

  /** Number of automatic reconnect attempts made in the current session. */
  get reconnectAttempts(): number {
    return this._reconnectAttempts;
  }

  /** Register a callback for incoming messages. */
  setMessageHandler(handler: MessageHandler): void {
    this.onMessage = handler;
  }

  /** Register a callback for connection status changes. */
  setStatusHandler(handler: StatusHandler): void {
    this.onStatus = handler;
  }

  /** Append an entry to the ring-buffer log (drops oldest when full). */
  private log(message: string): void {
    if (this._log.length >= MAX_LOG_ENTRIES) {
      this._log.shift();
    }
    this._log.push({ timestamp: Date.now(), message });
  }

  /** Connect to an MQTT broker and subscribe to the given topic filter. */
  connect(params: ConnectionParams): void {
    this.disconnect();
    this._lastBrokerUrl = params.brokerUrl;
    this._reconnectAttempts = 0;
    // Preserve the log across reconnects within the same session;
    // clear it only on a fresh user-initiated connect.
    this._log = [];

    this.log(`Connecting to ${params.brokerUrl}…`);
    this.onStatus?.("connecting");

    const options: IClientOptions = {
      protocolVersion: 5,
      clean: true,
      connectTimeout: 10_000,
      reconnectPeriod: 5_000,
    };

    if (params.clientId) options.clientId = params.clientId;
    if (params.username) options.username = params.username;
    if (params.password) options.password = params.password;

    this.client = mqtt.connect(params.brokerUrl, options);

    this.client.on("connect", () => {
      this._reconnectAttempts = 0;
      this.log(`Connected — subscribing to "${params.topicFilter}"`);
      this.onStatus?.("connected");
      this.client?.subscribe(params.topicFilter, { qos: 0 }, (err) => {
        if (err) {
          console.error("MQTT subscribe error:", err);
          this.log(`Subscribe error: ${err.message}`);
          this.onStatus?.("error", { message: err.message });
        }
      });
    });

    this.client.on("message", (topic, payload, packet) => {
      this.onMessage?.(
        topic, payload, packet.qos as 0 | 1 | 2, !!packet.retain,
        packet.properties?.userProperties,
      );
    });

    this.client.on("error", (err) => {
      console.error("MQTT error:", err);
      const code = (err as NodeJS.ErrnoException).code;
      this.log(`Error: ${err.message}`);
      this.onStatus?.("error", { message: err.message, code });
    });

    this.client.on("close", () => {
      // Only log the close if we're not about to reconnect (handled in "reconnect" event).
      // If reconnectAttempts >= MAX, we've already stopped the client — this fires as cleanup.
      this.log("Connection closed");
      this.onStatus?.("disconnected");
    });

    this.client.on("reconnect", () => {
      this._reconnectAttempts += 1;

      if (this._reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        // Cap reached — stop the client and surface a terminal error.
        this.log(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached — giving up`);
        // Remove listeners before end() to prevent the "close" event from
        // re-emitting "disconnected" after we've already emitted "error".
        this.client?.removeAllListeners();
        this.client?.end(true);
        this.client = null;
        this.onStatus?.("error", {
          message: `Could not connect after ${MAX_RECONNECT_ATTEMPTS} attempts. Check the broker URL and try again.`,
        });
        return;
      }

      this.log(`Reconnecting… (attempt ${this._reconnectAttempts} of ${MAX_RECONNECT_ATTEMPTS})`);
      this.onStatus?.("connecting");
    });

    this.client.on("offline", () => {
      this.log("Client went offline");
    });
  }

  /** Disconnect from the broker and clean up. Clears the log. */
  disconnect(): void {
    if (this.client) {
      this.client.removeAllListeners();
      this.client.end(true);
      this.client = null;
    }
    this._reconnectAttempts = 0;
  }

  /** Whether the client is currently connected. */
  get isConnected(): boolean {
    return this.client?.connected ?? false;
  }
}

/** Singleton MQTT service instance. */
export const mqttService = new MqttService();
