import { describe, it, expect } from "vitest";
import {
  formatRate,
  formatTimestamp,
  truncatePayload,
  formatUptime,
  depthScale,
  depthFontSize,
} from "../formatters";

describe("formatRate", () => {
  it('should return "0" for rate = 0', () => {
    expect(formatRate(0)).toBe("0");
  });

  it('should return "0" for very small rates below 0.01', () => {
    expect(formatRate(0.001)).toBe("0");
    expect(formatRate(0.009)).toBe("0");
  });

  it("should return 2 decimal places for rates < 1", () => {
    expect(formatRate(0.01)).toBe("0.01");
    expect(formatRate(0.5)).toBe("0.50");
    expect(formatRate(0.99)).toBe("0.99");
  });

  it("should return 1 decimal place for rates >= 1 and < 10", () => {
    expect(formatRate(1)).toBe("1.0");
    expect(formatRate(5.55)).toBe("5.5"); // toFixed uses banker's rounding
    expect(formatRate(9.99)).toBe("10.0");
  });

  it("should return rounded integer for rates >= 10", () => {
    expect(formatRate(10)).toBe("10");
    expect(formatRate(10.4)).toBe("10");
    expect(formatRate(10.5)).toBe("11");
    expect(formatRate(100)).toBe("100");
    expect(formatRate(999.9)).toBe("1000");
  });

  it('should return "0" for negative rates', () => {
    expect(formatRate(-1)).toBe("0");
    expect(formatRate(-0.5)).toBe("0");
  });
});

describe("formatTimestamp", () => {
  it('should return "never" for timestamp 0', () => {
    expect(formatTimestamp(0)).toBe("never");
  });

  it("should return a time string for a valid timestamp", () => {
    const ts = new Date("2025-01-15T10:30:00").getTime();
    const result = formatTimestamp(ts);
    // toLocaleTimeString output varies by locale, but should contain numbers
    expect(result).not.toBe("never");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should return a non-empty string for Date.now()", () => {
    const result = formatTimestamp(Date.now());
    expect(result).not.toBe("never");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("truncatePayload", () => {
  it('should return "(none)" for null payload', () => {
    expect(truncatePayload(null)).toBe("(none)");
  });

  it("should return the full payload if within the default limit", () => {
    expect(truncatePayload("hello")).toBe("hello");
  });

  it("should return the full payload at exactly 120 chars (default)", () => {
    const exact = "a".repeat(120);
    expect(truncatePayload(exact)).toBe(exact);
  });

  it("should truncate and append ... for payloads over 120 chars (default)", () => {
    const long = "b".repeat(150);
    const result = truncatePayload(long);
    expect(result).toHaveLength(123); // 120 + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  it("should respect a custom maxChars parameter", () => {
    const payload = "hello world";
    expect(truncatePayload(payload, 5)).toBe("hello...");
  });

  it("should handle empty string payload", () => {
    expect(truncatePayload("")).toBe("");
  });
});

describe("formatUptime", () => {
  it('should return "0s" for 0 ms', () => {
    expect(formatUptime(0)).toBe("0s");
  });

  it("should format seconds only", () => {
    expect(formatUptime(5000)).toBe("5s");
    expect(formatUptime(59000)).toBe("59s");
  });

  it("should format minutes and seconds", () => {
    expect(formatUptime(60000)).toBe("1m 0s");
    expect(formatUptime(90000)).toBe("1m 30s");
    expect(formatUptime(3599000)).toBe("59m 59s");
  });

  it("should format hours, minutes, and seconds", () => {
    expect(formatUptime(3600000)).toBe("1h 0m 0s");
    expect(formatUptime(3661000)).toBe("1h 1m 1s");
    expect(formatUptime(7200000)).toBe("2h 0m 0s");
  });

  it("should floor sub-second values", () => {
    expect(formatUptime(1500)).toBe("1s");
    expect(formatUptime(999)).toBe("0s");
  });

  it("should handle large durations", () => {
    // 25 hours
    const ms = 25 * 3600 * 1000;
    expect(formatUptime(ms)).toBe("25h 0m 0s");
  });
});

describe("depthScale", () => {
  it("should return full value for depth 0", () => {
    expect(depthScale(14, 0)).toBe(14);
    expect(depthScale(20, 0)).toBe(20);
    expect(depthScale(60, 0)).toBe(60);
  });

  it("should return smaller value for deeper nodes", () => {
    const base = 14;
    const depth1 = depthScale(base, 1);
    const depth2 = depthScale(base, 2);
    const depth3 = depthScale(base, 3);

    expect(depth1).toBeLessThan(base);
    expect(depth2).toBeLessThan(depth1);
    expect(depth3).toBeLessThan(depth2);
  });

  it("should use the formula value / (1 + depth * 0.3)", () => {
    expect(depthScale(14, 1)).toBeCloseTo(14 / 1.3, 5);
    expect(depthScale(14, 2)).toBeCloseTo(14 / 1.6, 5);
    expect(depthScale(14, 5)).toBeCloseTo(14 / 2.5, 5);
    expect(depthScale(20, 3)).toBeCloseTo(20 / 1.9, 5);
  });

  it("should always be positive for non-negative depth", () => {
    for (let depth = 0; depth <= 20; depth++) {
      expect(depthScale(14, depth)).toBeGreaterThan(0);
    }
  });

  it("should be monotonically decreasing with depth", () => {
    const base = 14;
    for (let depth = 1; depth <= 10; depth++) {
      expect(depthScale(base, depth)).toBeLessThan(depthScale(base, depth - 1));
    }
  });

  it("should scale linearly with baseSize", () => {
    const depth = 3;
    const size14 = depthScale(14, depth);
    const size28 = depthScale(28, depth);
    expect(size28).toBeCloseTo(size14 * 2, 5);
  });

  it("should work for node radius values (not just font sizes)", () => {
    // MIN_RADIUS=8 at depth 3 → 8 / (1 + 0.9) = 4.21
    expect(depthScale(8, 3)).toBeCloseTo(8 / 1.9, 5);
    // MAX_RADIUS=60 at depth 2 → 60 / (1 + 0.6) = 37.5
    expect(depthScale(60, 2)).toBeCloseTo(37.5, 5);
  });
});

describe("depthFontSize (backward-compat alias)", () => {
  it("should be the same function as depthScale", () => {
    expect(depthFontSize).toBe(depthScale);
  });

  it("should produce identical results", () => {
    expect(depthFontSize(14, 3)).toBe(depthScale(14, 3));
  });
});
