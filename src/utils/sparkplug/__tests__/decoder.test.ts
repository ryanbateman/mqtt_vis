import { describe, it, expect } from "vitest";
import { decodeSparkplugPayload } from "../decoder";
import { encodeSparkplugPayload, encodeRawField } from "./encodeHelper";

describe("decodeSparkplugPayload — payload fields", () => {
  it("decodes timestamp and seq", () => {
    const bytes = encodeSparkplugPayload({ timestamp: 1736014549000, seq: 42 });
    const decoded = decodeSparkplugPayload(bytes)!;
    expect(decoded.timestamp).toBe(1736014549000);
    expect(decoded.seq).toBe(42);
    expect(decoded.metrics).toEqual([]);
  });

  it("decodes an empty payload", () => {
    const decoded = decodeSparkplugPayload(new Uint8Array(0))!;
    expect(decoded).toEqual({ timestamp: null, seq: null, metrics: [] });
  });

  it("decodes a multi-metric NBIRTH-style payload", () => {
    const bytes = encodeSparkplugPayload({
      timestamp: 1000,
      seq: 0,
      metrics: [
        { name: "Temperature", alias: 1, datatype: 9, floatValue: 21.5 },
        { name: "Pressure", alias: 2, datatype: 10, doubleValue: 101.325 },
        { name: "Running", alias: 3, datatype: 11, booleanValue: true },
        { name: "Status", alias: 4, datatype: 12, stringValue: "OK" },
      ],
    });
    const decoded = decodeSparkplugPayload(bytes)!;
    expect(decoded.metrics).toHaveLength(4);
    expect(decoded.metrics[0].name).toBe("Temperature");
    expect(decoded.metrics[0].alias).toBe(1);
    expect(decoded.metrics[0].datatypeName).toBe("Float");
    expect(decoded.metrics[0].value).toBeCloseTo(21.5, 5);
    expect(decoded.metrics[1].value).toBeCloseTo(101.325, 9);
    expect(decoded.metrics[2].value).toBe(true);
    expect(decoded.metrics[3].value).toBe("OK");
  });
});

describe("decodeSparkplugPayload — value types", () => {
  it("decodes unsigned ints (UInt8/UInt32 via int_value)", () => {
    const bytes = encodeSparkplugPayload({
      metrics: [{ name: "m", datatype: 7, intValue: 4_000_000_000 }],
    });
    expect(decodeSparkplugPayload(bytes)!.metrics[0].value).toBe(4_000_000_000);
  });

  it("sign-extends negative Int32 values", () => {
    const bytes = encodeSparkplugPayload({
      metrics: [{ name: "m", datatype: 3, intValue: -42 }],
    });
    expect(decodeSparkplugPayload(bytes)!.metrics[0].value).toBe(-42);
  });

  it("decodes Int64 negatives via two's complement", () => {
    const bytes = encodeSparkplugPayload({
      metrics: [{ name: "m", datatype: 4, longValue: -123456789n }],
    });
    expect(decodeSparkplugPayload(bytes)!.metrics[0].value).toBe(-123456789);
  });

  it("decodes UInt64 within the safe range, null beyond it", () => {
    const ok = encodeSparkplugPayload({
      metrics: [{ name: "m", datatype: 8, longValue: 9007199254740991n }],
    });
    expect(decodeSparkplugPayload(ok)!.metrics[0].value).toBe(9007199254740991);

    const tooBig = encodeSparkplugPayload({
      metrics: [{ name: "m", datatype: 8, longValue: 9007199254740993n }],
    });
    expect(decodeSparkplugPayload(tooBig)!.metrics[0].value).toBeNull();
  });

  it("decodes DateTime (long_value ms epoch)", () => {
    const bytes = encodeSparkplugPayload({
      metrics: [{ name: "m", datatype: 13, longValue: 1736014549000n }],
    });
    const m = decodeSparkplugPayload(bytes)!.metrics[0];
    expect(m.value).toBe(1736014549000);
    expect(m.datatypeName).toBe("DateTime");
  });

  it("summarises bytes values without decoding them", () => {
    const bytes = encodeSparkplugPayload({
      metrics: [{ name: "m", datatype: 17, bytesValue: new Uint8Array([1, 2, 3]) }],
    });
    expect(decodeSparkplugPayload(bytes)!.metrics[0].value).toBe("<3 bytes>");
  });

  it("honours is_null over a present value", () => {
    const bytes = encodeSparkplugPayload({
      metrics: [{ name: "m", datatype: 3, intValue: 7, isNull: true }],
    });
    const m = decodeSparkplugPayload(bytes)!.metrics[0];
    expect(m.isNull).toBe(true);
    expect(m.value).toBeNull();
  });

  it("decodes alias-only metrics (name null)", () => {
    const bytes = encodeSparkplugPayload({
      metrics: [{ alias: 5, datatype: 9, floatValue: 1.25 }],
    });
    const m = decodeSparkplugPayload(bytes)!.metrics[0];
    expect(m.name).toBeNull();
    expect(m.alias).toBe(5);
    expect(m.value).toBeCloseTo(1.25, 6);
  });

  it("decodes metric-level timestamps", () => {
    const bytes = encodeSparkplugPayload({
      metrics: [{ name: "m", timestamp: 1700000000123, datatype: 11, booleanValue: false }],
    });
    expect(decodeSparkplugPayload(bytes)!.metrics[0].timestamp).toBe(1700000000123);
  });
});

describe("decodeSparkplugPayload — robustness", () => {
  it("skips unknown fields of every wire type", () => {
    const extras = new Uint8Array([
      ...encodeRawField(4, 2, new TextEncoder().encode("uuid-here")), // uuid (len-delim)
      ...encodeRawField(5, 2, [9, 9, 9]), // body (len-delim)
      ...encodeRawField(100, 0, [0x05]), // unknown varint
      ...encodeRawField(101, 5, [1, 2, 3, 4]), // unknown fixed32
      ...encodeRawField(102, 1, [1, 2, 3, 4, 5, 6, 7, 8]), // unknown fixed64
    ]);
    const bytes = encodeSparkplugPayload({ seq: 7, extraFields: extras });
    const decoded = decodeSparkplugPayload(bytes)!;
    expect(decoded.seq).toBe(7);
  });

  it("returns null on truncated input instead of throwing", () => {
    const good = encodeSparkplugPayload({
      timestamp: 1000,
      metrics: [{ name: "Temperature", datatype: 9, floatValue: 1 }],
    });
    const truncated = good.subarray(0, good.length - 3);
    expect(decodeSparkplugPayload(truncated)).toBeNull();
  });

  it("returns null on garbage input", () => {
    // 0xFF run: varint never terminates within 10 bytes
    expect(decodeSparkplugPayload(new Uint8Array(12).fill(0xff))).toBeNull();
  });

  it("handles metrics nested in a payload with unknown leading fields", () => {
    const extras = encodeRawField(8, 0, [0x01]); // unknown varint field before metrics
    const bytes = new Uint8Array([
      ...extras,
      ...encodeSparkplugPayload({ metrics: [{ name: "x", datatype: 12, stringValue: "y" }] }),
    ]);
    const decoded = decodeSparkplugPayload(bytes)!;
    expect(decoded.metrics[0].name).toBe("x");
  });
});
