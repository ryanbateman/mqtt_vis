import mqtt, { type MqttClient, type IClientOptions, type IPublishPacket } from "mqtt";
import type { ConnectionParams, MqttV5Properties } from "../types";

export type MessageHandler = (
  topic: string, payload: Buffer, qos: 0 | 1 | 2, retain: boolean,
  properties?: MqttV5Properties,
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

/**
 * Distill the useful MQTT v5 PUBLISH properties from an mqtt.js packet into a
 * plain, string-only object for the store. Returns undefined when the packet
 * carries no properties (v3.1.1 connections, or a v5 message with none), so the
 * store can treat "no metadata" uniformly. Binary correlation data is hex-encoded
 * here at the boundary.
 */
function distillV5Properties(
  properties: IPublishPacket["properties"],
): MqttV5Properties | undefined {
  if (!properties) return undefined;
  const cd = properties.correlationData;
  return {
    userProperties: properties.userProperties ?? null,
    contentType: properties.contentType,
    payloadFormatIndicator:
      properties.payloadFormatIndicator === undefined
        ? undefined
        : (properties.payloadFormatIndicator ? 1 : 0),
    messageExpiryInterval: properties.messageExpiryInterval,
    responseTopic: properties.responseTopic,
    correlationData: Buffer.isBuffer(cd) ? cd.toString("hex") : undefined,
  };
}

/** A single entry in the connection event log. */
export interface ConnectionLogEntry {
  /** Unix timestamp (ms). */
  timestamp: number;
  /** Short event label shown in the log. */
  message: string;
  /** Severity — "warn" highlights events like reconnect gaps. Defaults to "info". */
  level?: "info" | "warn";
}

/** Maximum entries kept in the connection log ring buffer. */
const MAX_LOG_ENTRIES = 20;

/** Maximum automatic reconnect attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 3;

/** Default MQTT keep-alive (seconds) when the caller doesn't specify one.
 *  Lower than mqtt.js's 60s default: halves dead-link detection (~45s worst
 *  case) and stays under typical ~60s WS proxy idle timeouts. */
const DEFAULT_KEEPALIVE_SECONDS = 30;

/** Floor for the keep-alive interval; guards against a stray 0 (which disables
 *  pings entirely in mqtt.js). */
const MIN_KEEPALIVE_SECONDS = 5;

/** Default subscribe QoS. 1 = at-least-once, so the broker redelivers un-acked
 *  messages on the live session (helps under load), unlike QoS 0's fire-and-forget.
 *  The broker may downgrade to its advertised maximum. */
const DEFAULT_SUBSCRIBE_QOS = 1;

/**
 * Maximum follow-on subscriptions (ecosystem-declared state/availability
 * topics) per connection. Matches the entity-cap order of magnitude while
 * staying a polite client on shared brokers.
 */
const MAX_FOLLOW_TOPICS = 2000;

/** Filters per SUBSCRIBE packet when following in bulk. */
const FOLLOW_BATCH_SIZE = 200;

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
  /** Timestamp (ms) the socket last went offline; null while connected/idle. */
  private _offlineSince: number | null = null;
  /** Count of completed reconnects this session (each implies a missed-message gap). */
  private _reconnectGaps = 0;
  /** Duration (s) of the most recent offline gap. */
  private _lastGapSeconds = 0;
  /** Follow-on subscriptions made this connection (dedupe + cap). */
  private _followed = new Set<string>();
  private _followCapWarned = false;

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

  /** Completed reconnects this session — each implies a window of missed messages. */
  get reconnectGaps(): number {
    return this._reconnectGaps;
  }

  /** Duration (s) of the most recent offline gap. */
  get lastGapSeconds(): number {
    return this._lastGapSeconds;
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
  private log(message: string, level: "info" | "warn" = "info"): void {
    if (this._log.length >= MAX_LOG_ENTRIES) {
      this._log.shift();
    }
    this._log.push({ timestamp: Date.now(), message, level });
  }

  /**
   * Detach a client and stop it. mqtt.js timers (e.g. the connack timeout)
   * can still fire after end(), emitting "error" — with no listener attached
   * that becomes an uncaught exception, so keep a swallow-all handler on.
   */
  private teardownClient(client: MqttClient): void {
    client.removeAllListeners();
    client.on("error", () => {});
    client.end(true);
  }

  /**
   * Subscribe to additional exact topics declared by ecosystem documents
   * (HA discovery state/availability topics living outside the primary
   * filter). Deduped per connection, capped at MAX_FOLLOW_TOPICS, sent in
   * batches; mqtt.js re-subscribes them automatically on reconnect.
   * Returns the number of newly followed topics.
   */
  followTopics(topics: string[]): number {
    if (!this.client || this.client.disconnected) return 0;

    const fresh: string[] = [];
    for (const topic of topics) {
      if (this._followed.has(topic)) continue;
      if (this._followed.size + fresh.length >= MAX_FOLLOW_TOPICS) {
        if (!this._followCapWarned) {
          this._followCapWarned = true;
          this.log(`Follow-topic cap (${MAX_FOLLOW_TOPICS}) reached — not following further ecosystem topics.`);
        }
        break;
      }
      fresh.push(topic);
    }
    if (fresh.length === 0) return 0;

    for (const topic of fresh) this._followed.add(topic);
    for (let i = 0; i < fresh.length; i += FOLLOW_BATCH_SIZE) {
      // Follow-on ecosystem topics stay at QoS 0 regardless of the user's chosen
      // subscribe QoS — best-effort, mostly-retained state/availability topics.
      this.client.subscribe(fresh.slice(i, i + FOLLOW_BATCH_SIZE), { qos: 0 });
    }
    this.log(`Following ${fresh.length} ecosystem topic${fresh.length === 1 ? "" : "s"} (total ${this._followed.size})`);
    return fresh.length;
  }

  /** Connect to an MQTT broker and subscribe to the given topic filter. */
  connect(params: ConnectionParams): void {
    this.disconnect();
    this._lastBrokerUrl = params.brokerUrl;
    this._followed.clear();
    this._followCapWarned = false;
    this._reconnectAttempts = 0;
    this._offlineSince = null;
    this._reconnectGaps = 0;
    this._lastGapSeconds = 0;
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
      keepalive: Math.max(
        MIN_KEEPALIVE_SECONDS,
        params.keepalive ?? DEFAULT_KEEPALIVE_SECONDS,
      ),
    };

    if (params.clientId) options.clientId = params.clientId;
    if (params.username) options.username = params.username;
    if (params.password) options.password = params.password;

    // Resolved once and captured by the "connect" handler below, so every
    // resubscribe on reconnect uses the same QoS.
    const subscribeQos = (params.qos ?? DEFAULT_SUBSCRIBE_QOS) as 0 | 1 | 2;

    this.client = mqtt.connect(params.brokerUrl, options);

    this.client.on("connect", () => {
      // A reconnect (rather than the first connect) means the socket was offline
      // for a window during which QoS-0 messages were lost — surface that gap.
      if (this._reconnectAttempts > 0 && this._offlineSince !== null) {
        this._lastGapSeconds = Math.round((Date.now() - this._offlineSince) / 1000);
        this._reconnectGaps += 1;
        this.log(
          `Reconnected after ${this._lastGapSeconds}s offline — messages published during the gap were missed`,
          "warn",
        );
      }
      this._offlineSince = null;
      this._reconnectAttempts = 0;
      this.log(`Connected — subscribing to "${params.topicFilter}"`);
      this.onStatus?.("connected");
      this.client?.subscribe(params.topicFilter, { qos: subscribeQos }, (err, granted) => {
        if (err) {
          console.error("MQTT subscribe error:", err);
          this.log(`Subscribe error: ${err.message}`);
          this.onStatus?.("error", { message: err.message });
        } else {
          // Report the QoS the broker actually granted — it may downgrade to its max.
          const grantedQos = granted?.[0]?.qos ?? subscribeQos;
          this.log(`Subscribed to "${params.topicFilter}" at QoS ${grantedQos}`);
        }
      });
    });

    this.client.on("message", (topic, payload, packet) => {
      this.onMessage?.(
        topic, payload, packet.qos as 0 | 1 | 2, !!packet.retain,
        distillV5Properties(packet.properties),
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
      // Mark when we went offline so a following reconnect can report the gap.
      if (this._offlineSince === null) this._offlineSince = Date.now();
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
        if (this.client) this.teardownClient(this.client);
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
      if (this._offlineSince === null) this._offlineSince = Date.now();
      this.log("Client went offline");
    });
  }

  /** Disconnect from the broker and clean up. Clears the log. */
  disconnect(): void {
    if (this.client) {
      this.teardownClient(this.client);
      this.client = null;
    }
    this._reconnectAttempts = 0;
    this._offlineSince = null;
    this._reconnectGaps = 0;
    this._lastGapSeconds = 0;
  }

  /** Whether the client is currently connected. */
  get isConnected(): boolean {
    return this.client?.connected ?? false;
  }
}

/** Singleton MQTT service instance. */
export const mqttService = new MqttService();
