import type { SparkplugMessageType, SparkplugTopicInfo } from "../../types/sparkplug";

/** The Sparkplug B namespace prefix. */
const NAMESPACE = "spBv1.0";

/** Valid message type segments. */
const MESSAGE_TYPES = new Set<SparkplugMessageType>([
  "NBIRTH", "NDEATH", "DBIRTH", "DDEATH",
  "NDATA", "DDATA", "NCMD", "DCMD", "STATE",
]);

/** Message types that signal lifecycle birth. */
export function isBirth(t: SparkplugMessageType): boolean {
  return t === "NBIRTH" || t === "DBIRTH";
}

/** Message types that signal lifecycle death. */
export function isDeath(t: SparkplugMessageType): boolean {
  return t === "NDEATH" || t === "DDEATH";
}

/** Cheap prefix test — used on the hot message path before full parsing. */
export function isSparkplugTopic(topic: string): boolean {
  return topic.startsWith(`${NAMESPACE}/`) || topic.startsWith("STATE/");
}

/**
 * Parse a Sparkplug topic into its components. Returns null when the topic
 * is not a valid Sparkplug topic.
 *
 * Recognised forms:
 * - spBv1.0/{group}/{message_type}/{edge_node}            (node-level)
 * - spBv1.0/{group}/{message_type}/{edge_node}/{device}   (device-level)
 * - spBv1.0/STATE/{host_id}                               (Sparkplug 3.0 host state)
 * - STATE/{host_id}                                       (legacy 2.2 host state)
 */
export function parseSparkplugTopic(topic: string): SparkplugTopicInfo | null {
  const segments = topic.split("/");

  // Legacy host state: STATE/{host_id}
  if (segments[0] === "STATE") {
    if (segments.length !== 2 || segments[1] === "") return null;
    return { groupId: "", messageType: "STATE", edgeNodeId: segments[1], deviceId: null };
  }

  if (segments[0] !== NAMESPACE) return null;

  // Sparkplug 3.0 host state: spBv1.0/STATE/{host_id}
  if (segments[1] === "STATE") {
    if (segments.length !== 3 || segments[2] === "") return null;
    return { groupId: "", messageType: "STATE", edgeNodeId: segments[2], deviceId: null };
  }

  // spBv1.0/{group}/{message_type}/{edge_node}[/{device}]
  if (segments.length < 4 || segments.length > 5) return null;
  const [, groupId, messageType, edgeNodeId, deviceId] = segments;
  if (!groupId || !edgeNodeId) return null;
  if (!MESSAGE_TYPES.has(messageType as SparkplugMessageType) || messageType === "STATE") {
    return null;
  }

  const isDeviceLevel = messageType.startsWith("D");
  if (isDeviceLevel && !deviceId) return null; // D* messages require a device segment
  if (!isDeviceLevel && deviceId !== undefined) return null; // N* messages must not have one

  return {
    groupId,
    messageType: messageType as SparkplugMessageType,
    edgeNodeId,
    deviceId: isDeviceLevel ? deviceId! : null,
  };
}

/**
 * Identity key for the edge node or device a message belongs to:
 * "group/edge" for node-level, "group/edge/device" for device-level.
 * STATE topics have no device identity — returns null.
 */
export function sparkplugDeviceKey(info: SparkplugTopicInfo): string | null {
  if (info.messageType === "STATE") return null;
  return info.deviceId !== null
    ? `${info.groupId}/${info.edgeNodeId}/${info.deviceId}`
    : `${info.groupId}/${info.edgeNodeId}`;
}
