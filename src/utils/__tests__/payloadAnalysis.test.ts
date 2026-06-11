import { describe, it, expect } from "vitest";
import {
  ANALYSIS_MAX_CHARS,
  prepareAnalysisPayload,
  fnv1a32,
} from "../payloadAnalysis";

describe("prepareAnalysisPayload", () => {
  it("passes short payloads through untouched", () => {
    const result = prepareAnalysisPayload('{"a":1}');
    expect(result.slice).toBe('{"a":1}');
    expect(result.truncated).toBe(false);
  });

  it("passes a payload exactly at the cap untouched", () => {
    const payload = "x".repeat(ANALYSIS_MAX_CHARS);
    const result = prepareAnalysisPayload(payload);
    expect(result.slice).toBe(payload);
    expect(result.truncated).toBe(false);
  });

  it("slices payloads over the cap and flags truncation", () => {
    const payload = "y".repeat(ANALYSIS_MAX_CHARS + 1);
    const result = prepareAnalysisPayload(payload);
    expect(result.slice.length).toBe(ANALYSIS_MAX_CHARS);
    expect(result.truncated).toBe(true);
  });

  it("handles the empty string", () => {
    expect(prepareAnalysisPayload("")).toEqual({ slice: "", truncated: false });
  });
});

describe("fnv1a32", () => {
  it("is deterministic", () => {
    expect(fnv1a32("hello world")).toBe(fnv1a32("hello world"));
  });

  it("matches the FNV-1a reference value for the empty string", () => {
    // FNV-1a 32-bit offset basis
    expect(fnv1a32("")).toBe(0x811c9dc5);
  });

  it("matches known FNV-1a test vectors", () => {
    // Reference values from the FNV specification test suite
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("differs for different inputs", () => {
    expect(fnv1a32('{"temp":1}')).not.toBe(fnv1a32('{"temp":2}'));
    expect(fnv1a32("OK")).not.toBe(fnv1a32("KO"));
  });

  it("returns an unsigned 32-bit integer", () => {
    for (const s of ["", "a", "longer test string", "��binary"]) {
      const h = fnv1a32(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(h)).toBe(true);
    }
  });
});
