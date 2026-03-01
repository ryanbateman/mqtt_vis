import { describe, it, expect } from "vitest";
import { rateToColor, pulseColor, linkColor, IDLE_COLOR, IDLE_STROKE } from "../colorScale";

/** Check that a string looks like a valid CSS colour (hex or rgb). */
function isValidColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color) || /^rgb\(/.test(color);
}

describe("colorScale constants", () => {
  it("should export IDLE_COLOR as slate-500 hex", () => {
    expect(IDLE_COLOR).toBe("#64748b");
  });

  it("should export IDLE_STROKE as slate-400 hex", () => {
    expect(IDLE_STROKE).toBe("#94a3b8");
  });
});

describe("rateToColor", () => {
  it("should return IDLE_COLOR for rate = 0", () => {
    expect(rateToColor(0)).toBe(IDLE_COLOR);
  });

  it("should return IDLE_COLOR for negative rates", () => {
    expect(rateToColor(-5)).toBe(IDLE_COLOR);
  });

  it("should return a valid colour for positive rates", () => {
    expect(isValidColor(rateToColor(1))).toBe(true);
    expect(isValidColor(rateToColor(10))).toBe(true);
    expect(isValidColor(rateToColor(100))).toBe(true);
  });

  it("should return a different colour from IDLE_COLOR for rate > 0", () => {
    expect(rateToColor(1)).not.toBe(IDLE_COLOR);
  });

  it("should return a valid colour for very small positive rates", () => {
    expect(isValidColor(rateToColor(0.01))).toBe(true);
  });

  it("should return a valid colour for very high rates", () => {
    expect(isValidColor(rateToColor(1000))).toBe(true);
  });
});

describe("pulseColor", () => {
  it("should return orange (#f97316) for rate = 0", () => {
    expect(pulseColor(0)).toBe("#f97316");
  });

  it("should return a valid colour for positive rates", () => {
    expect(isValidColor(pulseColor(1))).toBe(true);
    expect(isValidColor(pulseColor(50))).toBe(true);
  });

  it("should return a different colour from the rate=0 fallback for high rates", () => {
    expect(pulseColor(100)).not.toBe("#f97316");
  });
});

describe("linkColor", () => {
  it("should return a valid colour for rate = 0", () => {
    expect(isValidColor(linkColor(0))).toBe(true);
  });

  it("should return a valid colour for rate = 1", () => {
    expect(isValidColor(linkColor(1))).toBe(true);
  });

  it("should return different colours for rate 0 and rate 1", () => {
    expect(linkColor(0)).not.toBe(linkColor(1));
  });

  it("should clamp values outside 0-1 range", () => {
    // scaleLinear with clamp(true) should handle out-of-range values
    expect(isValidColor(linkColor(-1))).toBe(true);
    expect(isValidColor(linkColor(2))).toBe(true);
  });
});
