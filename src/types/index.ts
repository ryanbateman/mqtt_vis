import type { DetectorResult } from "./payloadTags";

/** MQTT v5 user properties — key-value pairs where values may repeat. */
export type MqttUserProperties = Record<string, string | string[]>;

/**
 * MQTT v5 PUBLISH properties distilled from the packet, forwarded from the
 * message handler to the store. Binary correlation data is hex-encoded at the
 * mqtt.js boundary so the rest of the app stays string-only, matching how
 * payloads are decoded there.
 */
export interface MqttV5Properties {
  /** MQTT v5 user properties (null if none). */
  userProperties: MqttUserProperties | null;
  /** Declared MIME type of the payload, e.g. "application/json". */
  contentType?: string;
  /** 0 = unspecified bytes, 1 = UTF-8 text. */
  payloadFormatIndicator?: 0 | 1;
  /** Message expiry in seconds. */
  messageExpiryInterval?: number;
  /** Response topic for the request/response pattern. */
  responseTopic?: string;
  /** Correlation data, hex-encoded. */
  correlationData?: string;
}

/**
 * Snapshot of the last message's MQTT metadata, retained on the node under the
 * same strategy as `lastPayload` (stored only when payload storage is enabled,
 * cleared together on LRU eviction) so payload and metadata stay one coherent
 * snapshot. QoS is deliberately NOT here — it is tracked unconditionally on the
 * node because always-on views (stats panel, tooltip, WebMCP) depend on it.
 */
export interface MqttMessageMeta extends MqttV5Properties {
  /** Whether the broker delivered this as a retained message. */
  retained: boolean;
}

/** A node in the MQTT topic tree. */
export interface TopicNode {
  /** Full topic path, e.g. "home/kitchen/temp". Root node uses "". */
  id: string;
  /** This node's segment name, e.g. "temp". Root uses "". */
  segment: string;
  /** Child nodes keyed by segment name. */
  children: Map<string, TopicNode>;
  /** Total messages received directly on this topic. */
  messageCount: number;
  /** EMA-based messages per second (direct only). */
  messageRate: number;
  /** Own rate + sum of all descendant aggregate rates. */
  aggregateRate: number;
  /** Last payload received (decoded as string). */
  lastPayload: string | null;
  /** Timestamp of the last message (ms since epoch). */
  lastTimestamp: number;
  /** QoS of the last message. */
  lastQoS: 0 | 1 | 2;
  /** Snapshot of the aggregate rate at the moment this node was last pulsed. */
  pulseRate: number;
  /** Character length of the most recent payload (0 if no messages received). */
  lastPayloadSize: number;
  /** High-water mark: largest payload character length ever seen on this topic. */
  largestPayloadSize: number;
  /** MQTT metadata of the last message (retained flag, user properties, v5 properties).
   *  Retained under the same strategy as lastPayload; null when not stored. */
  lastMeta: MqttMessageMeta | null;
  /** Payload analysis tags detected by the Web Worker (null if not yet analyzed). */
  payloadTags: DetectorResult[] | null;
  /** Blob URL for the most recent image payload (JPEG/PNG). Null if not an image topic.
   *  Must be revoked via URL.revokeObjectURL() on eviction/reset to prevent memory leaks. */
  lastImageBlobUrl: string | null;
}

/** A flat node for D3 force simulation. */
export interface GraphNode extends d3.SimulationNodeDatum {
  /** Full topic path (matches TopicNode.id). */
  id: string;
  /** Display label (segment name). */
  label: string;
  /** Target radius from aggregate rate (lerp target). */
  radius: number;
  /** Current displayed radius (smoothly interpolated toward radius). */
  displayRadius: number;
  /** Current message rate (direct). */
  messageRate: number;
  /** Aggregate rate (self + descendants). */
  aggregateRate: number;
  /** Depth in the topic tree (root = 0). */
  depth: number;
  /** Whether this node has received a message recently (for pulse effect). */
  pulse: boolean;
  /** Timestamp of the last pulse trigger. */
  pulseTimestamp: number;
  /** Snapshot of the peak rate at pulse time, used for fade colour interpolation. */
  pulseRate: number;
  /** Detected payload tag type names (e.g. ["geo"]). Empty array = analyzed, nothing found. Null = not yet analyzed. */
  payloadTags: string[] | null;
}

/** A link between parent and child for D3 force simulation. */
export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  /** Whether either endpoint is currently pulsing. */
  pulse?: boolean;
  /** Most recent pulse timestamp of either endpoint. */
  pulseTimestamp?: number;
}

/** Data passed from the renderer to React when a node is hovered. */
export interface TooltipData {
  /** Full topic path of the hovered node. */
  nodeId: string;
  /** Screen-space X coordinate for tooltip positioning. */
  screenX: number;
  /** Screen-space Y coordinate for tooltip positioning. */
  screenY: number;
}

/** How label visibility is determined. */
export type LabelMode = "zoom" | "depth" | "activity";

/** Display mode. "autotour" strips all chrome and runs the auto-tour (Esc to exit). */
export type DisplayMode = "normal" | "autotour";

/** Connection status of the MQTT client. */
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

/** Parameters for connecting to an MQTT broker. */
export interface ConnectionParams {
  brokerUrl: string;
  topicFilter: string;
  clientId?: string;
  username?: string;
  password?: string;
  /** MQTT keep-alive interval in seconds. Omitted → service default. */
  keepalive?: number;
  /** Subscribe QoS. Omitted → service default. Broker may downgrade to its max. */
  qos?: 0 | 1 | 2;
  /** MQTT protocol version: 5 or 4 (3.1.1). Omitted → service default. */
  protocolVersion?: 4 | 5;
}

/** A broker entry for the quick-connect dropdown. */
export interface Broker {
  /** Display name shown in the dropdown (e.g. "HiveMQ"). */
  name: string;
  /** WebSocket URL for the broker (e.g. "wss://broker.hivemq.com:8884/mqtt"). */
  url: string;
}

/** @deprecated Use Broker instead. */
export type PublicBroker = Broker;
