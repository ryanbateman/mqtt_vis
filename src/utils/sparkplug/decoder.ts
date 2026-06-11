import type { SparkplugDecodedPayload, SparkplugMetric } from "../../types/sparkplug";
import { datatypeName, SIGNED_INT_TYPES, SIGNED_LONG_TYPE } from "./datatypes";

/**
 * Minimal protobuf wire-format decoder for Sparkplug B payloads
 * (org.eclipse.tahu.protobuf.Payload).
 *
 * Hand-rolled on purpose: the app only reads Payload fields 1-3 and the
 * scalar Metric fields, the Sparkplug schema has been frozen for years, and
 * protobufjs would add ~25-30 KB gzip plus Function-constructor codegen for
 * no fidelity we use. Complex metric types (DataSet, Template, PropertySet,
 * MetaData) are skipped by wire type; their metrics decode with value null.
 * Should full fidelity ever be needed, switch to protobufjs/minimal with a
 * bundled JSON descriptor of the Tahu schema.
 *
 * Wire format reference: each field is a varint key (fieldNumber << 3 | wireType)
 * followed by a payload; wire types are 0 = varint, 1 = fixed 64-bit,
 * 2 = length-delimited, 5 = fixed 32-bit.
 */

const textDecoder = new TextDecoder();

/** Cursor over a protobuf buffer. Throws RangeError on truncated input. */
class ProtoReader {
  private pos = 0;
  private view: DataView;

  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get done(): boolean {
    return this.pos >= this.bytes.length;
  }

  /** Read a varint as BigInt (up to 64 bits). */
  varint(): bigint {
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.bytes.length) throw new RangeError("truncated varint");
      const byte = this.bytes[this.pos++];
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
    throw new RangeError("varint too long");
  }

  /** Read a length-delimited field as a subarray view. */
  lengthDelimited(): Uint8Array {
    const len = Number(this.varint());
    if (len < 0 || this.pos + len > this.bytes.length) {
      throw new RangeError("truncated length-delimited field");
    }
    const out = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  fixed32(): number {
    if (this.pos + 4 > this.bytes.length) throw new RangeError("truncated fixed32");
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  fixed64(): number {
    if (this.pos + 8 > this.bytes.length) throw new RangeError("truncated fixed64");
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  /** Skip a field of the given wire type. Throws on deprecated group types. */
  skip(wireType: number): void {
    switch (wireType) {
      case 0: this.varint(); break;
      case 1:
        if (this.pos + 8 > this.bytes.length) throw new RangeError("truncated skip");
        this.pos += 8;
        break;
      case 2: this.lengthDelimited(); break;
      case 5:
        if (this.pos + 4 > this.bytes.length) throw new RangeError("truncated skip");
        this.pos += 4;
        break;
      default:
        throw new RangeError(`unsupported wire type ${wireType}`);
    }
  }
}

/** Convert a uint64 BigInt to Number, or null when outside the safe range. */
function safeNumber(v: bigint): number | null {
  return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(v)
    : null;
}

/** Reinterpret an unsigned varint as the metric's signed value when needed. */
function applySign(raw: bigint, datatype: number, isLong: boolean): number | null {
  if (isLong) {
    // Int64: two's complement within 64 bits
    if (datatype === SIGNED_LONG_TYPE && raw > 0x7fffffffffffffffn) {
      return safeNumber(raw - 0x10000000000000000n);
    }
    return safeNumber(raw);
  }
  // Int8/16/32 are carried in int_value as uint32 two's complement
  if (SIGNED_INT_TYPES.has(datatype) && raw > 0x7fffffffn) {
    return Number(raw - 0x100000000n);
  }
  return safeNumber(raw);
}

/** Decode a single Metric message. */
function decodeMetric(bytes: Uint8Array): SparkplugMetric {
  const r = new ProtoReader(bytes);
  const metric: SparkplugMetric = {
    name: null,
    alias: null,
    datatype: 0,
    datatypeName: datatypeName(0),
    value: null,
    timestamp: null,
    isNull: false,
  };
  // The value oneof can arrive before the datatype field (field order is not
  // guaranteed), so raw values are buffered and interpreted at the end.
  let rawInt: bigint | null = null;
  let rawLong: bigint | null = null;

  while (!r.done) {
    const key = Number(r.varint());
    const field = key >> 3;
    const wire = key & 0x7;
    switch (field) {
      case 1: metric.name = textDecoder.decode(r.lengthDelimited()); break;
      case 2: metric.alias = safeNumber(r.varint()); break;
      case 3: metric.timestamp = safeNumber(r.varint()); break;
      case 4: metric.datatype = Number(r.varint()); break;
      case 7: metric.isNull = r.varint() !== 0n; break;
      case 10: rawInt = r.varint(); break;
      case 11: rawLong = r.varint(); break;
      case 12: metric.value = r.fixed32(); break;
      case 13: metric.value = r.fixed64(); break;
      case 14: metric.value = r.varint() !== 0n; break;
      case 15: metric.value = textDecoder.decode(r.lengthDelimited()); break;
      case 16: {
        const b = r.lengthDelimited();
        metric.value = `<${b.length} bytes>`;
        break;
      }
      default: r.skip(wire); break;
    }
  }

  metric.datatypeName = datatypeName(metric.datatype);
  if (rawInt !== null) metric.value = applySign(rawInt, metric.datatype, false);
  if (rawLong !== null) metric.value = applySign(rawLong, metric.datatype, true);
  if (metric.isNull) metric.value = null;
  return metric;
}

/**
 * Decode a Sparkplug B Payload message. Returns null on malformed input —
 * the caller treats that as "not decodable", never throws.
 */
export function decodeSparkplugPayload(bytes: Uint8Array): SparkplugDecodedPayload | null {
  try {
    const r = new ProtoReader(bytes);
    const payload: SparkplugDecodedPayload = { timestamp: null, seq: null, metrics: [] };

    while (!r.done) {
      const key = Number(r.varint());
      const field = key >> 3;
      const wire = key & 0x7;
      switch (field) {
        case 1: payload.timestamp = safeNumber(r.varint()); break;
        case 2: payload.metrics.push(decodeMetric(r.lengthDelimited())); break;
        case 3: payload.seq = safeNumber(r.varint()); break;
        default: r.skip(wire); break;
      }
    }
    return payload;
  } catch {
    return null;
  }
}
