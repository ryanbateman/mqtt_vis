/**
 * Eclipse Sparkplug B types.
 *
 * Topic namespace: spBv1.0/{group_id}/{message_type}/{edge_node_id}[/{device_id}]
 * plus host application state topics: spBv1.0/STATE/{host_id} (Sparkplug 3.0)
 * and STATE/{host_id} (legacy 2.2). Payloads are protobuf
 * (org.eclipse.tahu.protobuf.Payload) except STATE, which is JSON/plain text.
 */

/** Sparkplug message types from the topic's third segment. */
export type SparkplugMessageType =
  | "NBIRTH"
  | "NDEATH"
  | "DBIRTH"
  | "DDEATH"
  | "NDATA"
  | "DDATA"
  | "NCMD"
  | "DCMD"
  | "STATE";

/** Parsed components of a Sparkplug topic. */
export interface SparkplugTopicInfo {
  /** Group ID (empty string for STATE topics, which have none). */
  groupId: string;
  /** The message type segment. */
  messageType: SparkplugMessageType;
  /** Edge node ID — or the host ID for STATE topics. */
  edgeNodeId: string;
  /** Device ID for device-level messages (D*), null for node-level. */
  deviceId: string | null;
}

/** A single decoded metric from a Sparkplug payload. */
export interface SparkplugMetric {
  /** Metric name. Null when the metric arrived alias-only and the alias is unknown. */
  name: string | null;
  /** Numeric alias assigned in the BIRTH message, if any. */
  alias: number | null;
  /** Sparkplug datatype code (see datatypes.ts). 0 = unspecified. */
  datatype: number;
  /** Human-readable datatype name, e.g. "Int32". */
  datatypeName: string;
  /** Decoded value. Null when is_null or when the value type is unsupported. */
  value: number | string | boolean | null;
  /** Metric-level timestamp (ms since epoch), if present. */
  timestamp: number | null;
  /** True when the payload explicitly marked the metric null. */
  isNull: boolean;
}

/** A decoded Sparkplug B protobuf payload (the subset this app reads). */
export interface SparkplugDecodedPayload {
  /** Payload timestamp (ms since epoch), if present. */
  timestamp: number | null;
  /** Sequence number (0-255), if present. */
  seq: number | null;
  /** Decoded metrics. */
  metrics: SparkplugMetric[];
}

/** Live state of one Sparkplug edge node or device, keyed by deviceKey. */
export interface SparkplugDeviceState {
  /** Identity key: "group/edge" or "group/edge/device". */
  deviceKey: string;
  /** Whether this entry is an edge node or a device under one. */
  role: "edge-node" | "device";
  groupId: string;
  edgeNodeId: string;
  /** Device ID, null for edge nodes. */
  deviceId: string | null;
  /** Online per BIRTH/DEATH lifecycle (DATA also implies alive). */
  online: boolean;
  /** The most recent message type seen for this entity. */
  lastMessageType: SparkplugMessageType;
  /** Wall-clock ms of the last BIRTH seen, null if none. */
  lastBirthTimestamp: number | null;
  /** Wall-clock ms of the last DATA seen, null if none. */
  lastDataTimestamp: number | null;
  /** Last payload seq number seen, null if none. */
  lastSeq: number | null;
  /** Count of detected seq discontinuities (approximate — DATA is debounced). */
  seqGapCount: number;
  /** Latest value per metric name (alias-resolved). Capped at METRICS_CAP. */
  metrics: Map<string, SparkplugMetric>;
  /** All topic node IDs this entity's messages have arrived on (NBIRTH/NDATA/... branches). */
  topicNodeIds: Set<string>;
}

/** Slim per-topic-node tag metadata pointing at the device state slice. */
export interface SparkplugMetadata {
  /** Key into the sparkplugDevices store slice. */
  deviceKey: string;
  /** Edge node or device. */
  role: "edge-node" | "device";
  /** Message type of the message that tagged this node. */
  messageType: SparkplugMessageType;
  /** Online state at tag time (authoritative state lives in the store slice). */
  online: boolean;
  /** Number of metrics known for the device at tag time. */
  metricCount: number;
  /**
   * Full decoded metrics — populated only on the worker → main thread wire;
   * setPayloadTags strips this into the device state before storing the tag.
   */
  metrics?: SparkplugMetric[];
  /** Payload seq from the decoded message (wire-only, stripped with metrics). */
  seq?: number | null;
  /** Payload timestamp from the decoded message (wire-only, stripped with metrics). */
  payloadTimestamp?: number | null;
}
