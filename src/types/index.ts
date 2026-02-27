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
}

/** A flat node for D3 force simulation. */
export interface GraphNode extends d3.SimulationNodeDatum {
  /** Full topic path (matches TopicNode.id). */
  id: string;
  /** Display label (segment name). */
  label: string;
  /** Computed radius from aggregate rate. */
  radius: number;
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

/** A particle in a burst effect. */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  radius: number;
  color: string;
}
