import type { SparkplugMetadata } from "./sparkplug";
import type { EntityDeclaration } from "./entities";

/** Supported payload tag types. Extensible as new detectors are added. */
export type PayloadTagType =
  | "geo"
  | "image"
  | "sparkplug"
  | "homeassistant"
  | "frigate"
  | "shelly"
  | "owntracks"
  | "ttn"
  | "chirpstack"
  | "homie"
  | "opendtu"
  | "tasmota"
  | "wled";

/** Detected geo coordinates extracted from a JSON payload. */
export interface GeoMetadata {
  /** Latitude value (-90 to 90). */
  lat: number;
  /** Longitude value (-180 to 180). */
  lon: number;
  /** JSON path to the latitude field, e.g. "location.lat". */
  latPath: string;
  /** JSON path to the longitude field, e.g. "location.lon". */
  lonPath: string;
  /**
   * Timestamp (ms since epoch) the reading was taken, when the payload
   * carries one (OwnTracks `tst`). Lets geo trails use the device's own
   * GPS time instead of arrival time. Absent when no timestamp was found.
   */
  timestamp?: number;
  /** JSON path to the timestamp field, when present. */
  tstPath?: string;
}

/** Detected image format metadata extracted from a binary payload. */
export interface ImageMetadata {
  /** Detected image format. */
  format: "jpeg" | "png";
  /** Sub-format detail (e.g. "jfif", "exif" for JPEG). Null when not applicable. */
  subFormat: string | null;
  /** Approximate payload size in bytes (derived from string length). */
  sizeBytes: number;
}

/**
 * Slim per-topic-node tag metadata pointing at the entity registry.
 * Shared by every registry-backed ecosystem tag (homeassistant, frigate,
 * shelly, ...).
 */
export interface EntityTagMetadata {
  /** Key into the domainEntities store slice. */
  entityKey: string;
  /** Entity role (component type, "device", "camera", ...). */
  role: string;
  /** Human label at tag time (authoritative state lives in the registry). */
  label: string;
  /** Online state at tag time, null when no availability signal exists. */
  online: boolean | null;
  /**
   * Full parsed declarations — populated only on the worker → main thread
   * wire; setPayloadTags strips this into the entity registry before
   * storing the tag.
   */
  declarations?: EntityDeclaration[];
}

/** Mapping from tag type to its metadata shape. */
export interface TagMetadataMap {
  geo: GeoMetadata;
  image: ImageMetadata;
  sparkplug: SparkplugMetadata;
  homeassistant: EntityTagMetadata;
  frigate: EntityTagMetadata;
  shelly: EntityTagMetadata;
  owntracks: EntityTagMetadata;
  ttn: EntityTagMetadata;
  chirpstack: EntityTagMetadata;
  homie: EntityTagMetadata;
  opendtu: EntityTagMetadata;
  tasmota: EntityTagMetadata;
  wled: EntityTagMetadata;
}

/** A single detection result from a payload analyzer detector. */
export interface DetectorResult<T extends PayloadTagType = PayloadTagType> {
  /** The type of data detected. */
  tag: T;
  /** Confidence score (0-1). Higher = more confident the detection is correct. */
  confidence: number;
  /** Tag-specific metadata (e.g. coordinates for geo). */
  metadata: TagMetadataMap[T];
  /** JSON path where the detection was made, e.g. "position.latitude". */
  fieldPath: string;
}

/** A topic node with confirmed geo coordinates — used for multi-geo map views. */
export interface GeoNode {
  /** Full MQTT topic path. */
  topicPath: string;
  /** Detected coordinates. */
  geo: GeoMetadata;
}

// --- Trail types ------------------------------------------------------------

/** A single historical position in a geo trail. */
export interface TrailPoint {
  /** Latitude value. */
  lat: number;
  /** Longitude value. */
  lon: number;
  /** Timestamp (ms since epoch) when this position was recorded. */
  timestamp: number;
}

// --- Worker message protocol ------------------------------------------------

/** Message sent from main thread to the payload analyzer worker. */
export interface AnalyzeRequest {
  type: "analyze";
  /** The topic node ID to associate results with. */
  nodeId: string;
  /** The full MQTT topic the payload arrived on (for topic-aware detectors). */
  topic: string;
  /** The payload string to analyze, sliced to ANALYSIS_MAX_CHARS. */
  payload: string;
  /** True when the payload was truncated — JSON detectors are skipped. */
  truncated: boolean;
  /**
   * Raw payload bytes for binary-format detectors (e.g. protobuf).
   * Sent as a transferable, so only populated when a topic-aware detector
   * needs it (currently sparkplug topics only).
   */
  rawBytes?: ArrayBuffer;
}

/** Clears all worker-held analysis state (e.g. on disconnect/reset). */
export interface ResetRequest {
  type: "reset";
}

/** Message sent from the payload analyzer worker back to the main thread. */
export interface AnalyzeResponse {
  type: "result";
  /** The topic node ID these results belong to. */
  nodeId: string;
  /** All detector results found in the payload. Empty array if nothing detected. */
  tags: DetectorResult[];
}

/** Union of all worker message types (main -> worker). */
export type WorkerRequest = AnalyzeRequest | ResetRequest;

/** Union of all worker message types (worker -> main). */
export type WorkerResponse = AnalyzeResponse;
