import { describe, it, expect } from "vitest";
import { detectImage } from "../imageDetector";

/**
 * Helper to build a fake payload string that mimics what happens when binary
 * image data is decoded as UTF-8 by the MQTT client.
 *
 * Bytes > 0x7F become the Unicode replacement character U+FFFD.
 * ASCII bytes survive as-is.
 */
function fakeUtf8Decode(bytes: number[]): string {
  return bytes.map((b) => (b > 0x7F ? "\uFFFD" : String.fromCharCode(b))).join("");
}

// --- JPEG magic bytes ---
// JFIF: FF D8 FF E0 xx xx 4A 46 49 46 ("JFIF")
const JPEG_JFIF_HEADER = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01];
// Exif: FF D8 FF E1 xx xx 45 78 69 66 ("Exif")
const JPEG_EXIF_HEADER = [0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

// --- PNG magic bytes ---
// PNG: 89 50 4E 47 0D 0A 1A 0A
const PNG_HEADER = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

describe("detectImage", () => {
  // --- JPEG detection ---

  describe("JPEG detection", () => {
    it("should detect JPEG/JFIF payload", () => {
      const payload = fakeUtf8Decode(JPEG_JFIF_HEADER) + "x".repeat(1000);
      const results = detectImage(payload);
      expect(results).toHaveLength(1);
      expect(results[0].tag).toBe("image");
      expect(results[0].metadata.format).toBe("jpeg");
      expect(results[0].metadata.subFormat).toBe("jfif");
      expect(results[0].confidence).toBe(0.95);
    });

    it("should detect JPEG/Exif payload", () => {
      const payload = fakeUtf8Decode(JPEG_EXIF_HEADER) + "x".repeat(500);
      const results = detectImage(payload);
      expect(results).toHaveLength(1);
      expect(results[0].tag).toBe("image");
      expect(results[0].metadata.format).toBe("jpeg");
      expect(results[0].metadata.subFormat).toBe("exif");
    });

    it("should report correct sizeBytes from string length", () => {
      const payload = fakeUtf8Decode(JPEG_JFIF_HEADER) + "x".repeat(9000);
      const results = detectImage(payload);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.sizeBytes).toBe(payload.length);
    });

    it("should set fieldPath to empty string", () => {
      const payload = fakeUtf8Decode(JPEG_JFIF_HEADER);
      const results = detectImage(payload);
      expect(results).toHaveLength(1);
      expect(results[0].fieldPath).toBe("");
    });
  });

  // --- PNG detection ---

  describe("PNG detection", () => {
    it("should detect PNG payload", () => {
      const payload = fakeUtf8Decode(PNG_HEADER) + "x".repeat(2000);
      const results = detectImage(payload);
      expect(results).toHaveLength(1);
      expect(results[0].tag).toBe("image");
      expect(results[0].metadata.format).toBe("png");
      expect(results[0].metadata.subFormat).toBeNull();
      expect(results[0].confidence).toBe(0.95);
    });

    it("should report correct sizeBytes for PNG", () => {
      const payload = fakeUtf8Decode(PNG_HEADER) + "x".repeat(5000);
      const results = detectImage(payload);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.sizeBytes).toBe(payload.length);
    });
  });

  // --- Negative cases ---

  describe("non-image payloads", () => {
    it("should not detect plain JSON", () => {
      const results = detectImage('{"temperature": 22.5}');
      expect(results).toHaveLength(0);
    });

    it("should not detect plain text", () => {
      const results = detectImage("hello world");
      expect(results).toHaveLength(0);
    });

    it("should not detect empty string", () => {
      const results = detectImage("");
      expect(results).toHaveLength(0);
    });

    it("should not detect short string (< 4 chars)", () => {
      const results = detectImage("abc");
      expect(results).toHaveLength(0);
    });

    it("should not detect string starting with replacement char but no known header", () => {
      // Generic binary data — starts with \uFFFD but no JFIF/Exif/PNG signature
      const payload = "\uFFFD\uFFFDXY" + "z".repeat(100);
      const results = detectImage(payload);
      expect(results).toHaveLength(0);
    });

    it("should not detect JFIF string that doesn't start with replacement char", () => {
      // "JFIF" appears but not at the expected position after a binary header
      const results = detectImage("some text with JFIF in it");
      expect(results).toHaveLength(0);
    });

    it("should not detect PNG string that doesn't start with replacement char", () => {
      const results = detectImage("PNG is a format");
      expect(results).toHaveLength(0);
    });

    it("should not detect a number payload", () => {
      const results = detectImage("42");
      expect(results).toHaveLength(0);
    });
  });

  // --- Edge cases ---

  describe("edge cases", () => {
    it("should detect JPEG with minimal header (just enough for JFIF string)", () => {
      // Exactly the bytes needed to trigger detection
      const payload = fakeUtf8Decode([0xFF, 0xD8, 0xFF, 0xE0]) + "\x00\x10JFIF";
      const results = detectImage(payload);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.format).toBe("jpeg");
    });

    it("should detect PNG with minimal header", () => {
      const payload = fakeUtf8Decode(PNG_HEADER);
      const results = detectImage(payload);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.format).toBe("png");
    });

    it("should handle replacement char followed by other binary noise", () => {
      // Starts with \uFFFD but then just ASCII noise — not an image
      const payload = "\uFFFD" + "abcdefghijklmnopqrst";
      const results = detectImage(payload);
      expect(results).toHaveLength(0);
    });

    it("should prefer JFIF over Exif when both appear (JFIF checked first)", () => {
      // In practice this can't happen (a JPEG is either JFIF or Exif),
      // but test that the first match wins.
      const payload = fakeUtf8Decode([0xFF, 0xD8, 0xFF, 0xE0]) + "\x00\x10JFIF\x00Exif";
      const results = detectImage(payload);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.subFormat).toBe("jfif");
    });
  });
});
