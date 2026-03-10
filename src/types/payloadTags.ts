/** Supported payload tag types. Extensible as new detectors are added. */
export type PayloadTagType = "geo";

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
}

/** Mapping from tag type to its metadata shape. */
export interface TagMetadataMap {
  geo: GeoMetadata;
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
  /** The raw payload string to analyze. */
  payload: string;
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
export type WorkerRequest = AnalyzeRequest;

/** Union of all worker message types (worker -> main). */
export type WorkerResponse = AnalyzeResponse;
