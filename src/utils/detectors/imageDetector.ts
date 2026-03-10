import type { DetectorResult } from "../../types/payloadTags";

/**
 * Unicode replacement character — inserted by UTF-8 decoding when a byte
 * sequence is invalid (e.g. binary data > 0x7F interpreted as text).
 */
const REPLACEMENT_CHAR = "\uFFFD";

/**
 * Detect JPEG and PNG image payloads from their magic-byte signatures.
 *
 * MQTT payloads arrive as UTF-8 decoded strings.  Binary image data has
 * bytes > 0x7F which become U+FFFD replacement characters, but the ASCII
 * portions of the file header survive intact.  We use the surviving ASCII
 * markers to identify image formats:
 *
 * **JPEG** — bytes `FF D8 FF E0` (JFIF) or `FF D8 FF E1` (Exif).
 *   After UTF-8 decoding the `FF` bytes become `\uFFFD` but the ASCII
 *   strings "JFIF" and "Exif" survive within the first ~20 characters.
 *
 * **PNG** — bytes `89 50 4E 47 0D 0A 1A 0A`.  The `89` byte becomes
 *   `\uFFFD` but bytes `50 4E 47` are the ASCII letters "PNG".
 *
 * This detector operates on the **raw payload string**, not on parsed JSON.
 * It should be called before JSON parsing in the worker pipeline.
 *
 * @param payload  The raw payload string (UTF-8 decoded MQTT message).
 * @returns  Array of detection results (0 or 1 elements).
 */
export function detectImage(payload: string): DetectorResult<"image">[] {
  if (payload.length < 4) return [];

  // Fast exit: binary image payloads always start with a replacement char
  // (the first byte of JPEG is 0xFF, PNG is 0x89 — both > 0x7F).
  if (payload[0] !== REPLACEMENT_CHAR) return [];

  // Check a limited prefix to avoid scanning huge payloads
  const prefix = payload.slice(0, 20);

  // --- JPEG detection -------------------------------------------------------
  // JFIF: FF D8 FF E0 ... "JFIF"  (APP0 marker)
  // Exif: FF D8 FF E1 ... "Exif"  (APP1 marker)
  const jfifIdx = prefix.indexOf("JFIF");
  if (jfifIdx !== -1) {
    return [makeResult("jpeg", "jfif", payload.length)];
  }

  const exifIdx = prefix.indexOf("Exif");
  if (exifIdx !== -1) {
    return [makeResult("jpeg", "exif", payload.length)];
  }

  // --- PNG detection --------------------------------------------------------
  // PNG magic: 89 50 4E 47 — after UTF-8 decoding: \uFFFD P N G
  // Check chars 1-3 for "PNG"
  if (payload.length >= 4 && payload[1] === "P" && payload[2] === "N" && payload[3] === "G") {
    return [makeResult("png", null, payload.length)];
  }

  return [];
}

/** Build a DetectorResult for a detected image format. */
function makeResult(
  format: "jpeg" | "png",
  subFormat: string | null,
  sizeBytes: number,
): DetectorResult<"image"> {
  return {
    tag: "image",
    confidence: 0.95,
    metadata: { format, subFormat, sizeBytes },
    fieldPath: "",
  };
}
