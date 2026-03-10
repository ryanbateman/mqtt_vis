import type { DetectorResult, GeoMetadata } from "../../types/payloadTags";

/**
 * Known key-pair patterns for latitude/longitude fields.
 * Each entry maps a lat key (lowercase) to its lon counterpart and a confidence
 * score reflecting how specific the key names are.
 */
const LAT_LON_PAIRS: { lat: string; lon: string; confidence: number }[] = [
  { lat: "latitude", lon: "longitude", confidence: 1.0 },
  { lat: "lat", lon: "lon", confidence: 0.9 },
  { lat: "lat", lon: "lng", confidence: 0.9 },
  { lat: "lat", lon: "long", confidence: 0.85 },
];

/**
 * Coerce a value to a finite number.  Accepts actual numbers and non-empty
 * numeric strings (a very common pattern in MQTT payloads).  Returns NaN for
 * anything else so the range checks below will reject it.
 */
function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim().length > 0) return Number(v);
  return NaN;
}

/** Check whether a value is a valid latitude (-90 to 90). */
function isValidLat(v: unknown): boolean {
  const n = toNumber(v);
  return Number.isFinite(n) && n >= -90 && n <= 90;
}

/** Check whether a value is a valid longitude (-180 to 180). */
function isValidLon(v: unknown): boolean {
  const n = toNumber(v);
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

/**
 * Build a dot-separated JSON path from parent path and current key.
 * If inside an array, the key is the numeric index wrapped in brackets.
 */
function buildPath(parentPath: string, key: string): string {
  return parentPath ? `${parentPath}.${key}` : key;
}

/**
 * Recursively scan a parsed JSON value for latitude/longitude coordinate pairs.
 *
 * Heuristics:
 * - Looks for adjacent keys in the same object that match known lat/lon patterns
 *   (case-insensitive).
 * - Values must be numbers within valid geographic ranges.
 * - Handles nested objects and arrays.
 * - Returns all found pairs with their JSON paths and confidence scores.
 *
 * This function is pure and side-effect-free.
 */
export function detectGeo(value: unknown): DetectorResult<"geo">[] {
  const results: DetectorResult<"geo">[] = [];
  walk(value, "", results);
  return results;
}

function walk(
  value: unknown,
  path: string,
  results: DetectorResult<"geo">[],
): void {
  if (value === null || value === undefined || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walk(value[i], buildPath(path, `[${i}]`), results);
    }
    return;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);

  // --- GeoJSON Point detection ------------------------------------------------
  // GeoJSON spec (RFC 7946): { "type": "Point", "coordinates": [lon, lat] }
  // Coordinate order is [longitude, latitude, optional altitude].
  if (
    obj.type === "Point" &&
    Array.isArray(obj.coordinates) &&
    obj.coordinates.length >= 2
  ) {
    const lonVal = obj.coordinates[0];
    const latVal = obj.coordinates[1];
    if (isValidLon(lonVal) && isValidLat(latVal)) {
      const coordPath = buildPath(path, "coordinates");
      results.push({
        tag: "geo",
        confidence: 0.95,
        metadata: {
          lat: toNumber(latVal),
          lon: toNumber(lonVal),
          latPath: `${coordPath}[1]`,
          lonPath: `${coordPath}[0]`,
        },
        fieldPath: path || "coordinates",
      });
    }
  }

  // --- Key-pair detection -----------------------------------------------------
  // Build a case-insensitive lookup of this object's keys
  const lowerKeyMap = new Map<string, string>(); // lowercase → original key
  for (const k of keys) {
    lowerKeyMap.set(k.toLowerCase(), k);
  }

  // Check each known lat/lon key pair
  for (const pair of LAT_LON_PAIRS) {
    const latKey = lowerKeyMap.get(pair.lat);
    const lonKey = lowerKeyMap.get(pair.lon);

    if (latKey !== undefined && lonKey !== undefined) {
      const latVal = obj[latKey];
      const lonVal = obj[lonKey];

      if (isValidLat(latVal) && isValidLon(lonVal)) {
        const latPath = buildPath(path, latKey);
        const lonPath = buildPath(path, lonKey);

        const metadata: GeoMetadata = {
          lat: toNumber(latVal),
          lon: toNumber(lonVal),
          latPath,
          lonPath,
        };

        results.push({
          tag: "geo",
          confidence: pair.confidence,
          metadata,
          fieldPath: path || latKey,
        });
      }
    }
  }

  // Recurse into child values (objects and arrays)
  for (const k of keys) {
    const childVal = obj[k];
    if (childVal !== null && typeof childVal === "object") {
      walk(childVal, buildPath(path, k), results);
    }
  }
}
