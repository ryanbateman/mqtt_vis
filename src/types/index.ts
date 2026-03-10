import type { DetectorResult } from "./payloadTags";

/** MQTT v5 user properties — key-value pairs where values may repeat. */
export type MqttUserProperties = Record<string, string | string[]>;

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
  /** MQTT v5 user properties from the last message (null if none or v4 connection). */
  lastUserProperties: MqttUserProperties | null;
  /** Payload analysis tags detected by the Web Worker (null if not yet analyzed). */
  payloadTags: DetectorResult[] | null;
  /** Whether this node's payload has been submitted for analysis. */
  tagsAnalyzed: boolean;
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

/** Connection status of the MQTT client. */
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

/** Parameters for connecting to an MQTT broker. */
export interface ConnectionParams {
  brokerUrl: string;
  topicFilter: string;
  clientId?: string;
  username?: string;
  password?: string;
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
