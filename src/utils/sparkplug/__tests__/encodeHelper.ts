/**
 * Minimal protobuf encoder for Sparkplug B Payload messages.
 *
 * Used ONLY by decoder tests and scripts/publish-sparkplug.ts to build wire
 * fixtures — never imported by application code, so it ships in no bundle.
 */

/** A metric spec for encoding. All fields optional except what the test needs. */
export interface EncodeMetric {
  name?: string;
  alias?: number;
  timestamp?: number;
  datatype?: number;
  isNull?: boolean;
  intValue?: number;       // field 10 (uint32 varint; negatives encoded two's complement)
  longValue?: bigint;      // field 11 (uint64 varint; negatives encoded two's complement)
  floatValue?: number;     // field 12 (fixed32)
  doubleValue?: number;    // field 13 (fixed64)
  booleanValue?: boolean;  // field 14
  stringValue?: string;    // field 15
  bytesValue?: Uint8Array; // field 16
}

export interface EncodePayload {
  timestamp?: number;
  metrics?: EncodeMetric[];
  seq?: number;
  /** Extra raw field bytes appended verbatim (for unknown-field skip tests). */
  extraFields?: Uint8Array;
}

const textEncoder = new TextEncoder();

function writeVarint(out: number[], value: bigint): void {
  let v = value & 0xffffffffffffffffn; // wrap negatives to two's complement
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) byte |= 0x80;
    out.push(byte);
  } while (v !== 0n);
}

function writeTag(out: number[], field: number, wireType: number): void {
  writeVarint(out, BigInt((field << 3) | wireType));
}

function writeLengthDelimited(out: number[], field: number, bytes: Uint8Array): void {
  writeTag(out, field, 2);
  writeVarint(out, BigInt(bytes.length));
  for (const b of bytes) out.push(b);
}

function writeFixed32(out: number[], field: number, value: number): void {
  writeTag(out, field, 5);
  const buf = new DataView(new ArrayBuffer(4));
  buf.setFloat32(0, value, true);
  for (let i = 0; i < 4; i++) out.push(buf.getUint8(i));
}

function writeFixed64(out: number[], field: number, value: number): void {
  writeTag(out, field, 1);
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, value, true);
  for (let i = 0; i < 8; i++) out.push(buf.getUint8(i));
}

/** Encode one Metric message body. */
export function encodeMetric(m: EncodeMetric): Uint8Array {
  const out: number[] = [];
  if (m.name !== undefined) writeLengthDelimited(out, 1, textEncoder.encode(m.name));
  if (m.alias !== undefined) {
    writeTag(out, 2, 0);
    writeVarint(out, BigInt(m.alias));
  }
  if (m.timestamp !== undefined) {
    writeTag(out, 3, 0);
    writeVarint(out, BigInt(m.timestamp));
  }
  if (m.datatype !== undefined) {
    writeTag(out, 4, 0);
    writeVarint(out, BigInt(m.datatype));
  }
  if (m.isNull !== undefined) {
    writeTag(out, 7, 0);
    writeVarint(out, m.isNull ? 1n : 0n);
  }
  if (m.intValue !== undefined) {
    writeTag(out, 10, 0);
    // uint32 two's complement for negative Int8/16/32 values
    writeVarint(out, BigInt(m.intValue >>> 0));
  }
  if (m.longValue !== undefined) {
    writeTag(out, 11, 0);
    writeVarint(out, m.longValue);
  }
  if (m.floatValue !== undefined) writeFixed32(out, 12, m.floatValue);
  if (m.doubleValue !== undefined) writeFixed64(out, 13, m.doubleValue);
  if (m.booleanValue !== undefined) {
    writeTag(out, 14, 0);
    writeVarint(out, m.booleanValue ? 1n : 0n);
  }
  if (m.stringValue !== undefined) {
    writeLengthDelimited(out, 15, textEncoder.encode(m.stringValue));
  }
  if (m.bytesValue !== undefined) writeLengthDelimited(out, 16, m.bytesValue);
  return new Uint8Array(out);
}

/** Encode a full Payload message. */
export function encodeSparkplugPayload(p: EncodePayload): Uint8Array {
  const out: number[] = [];
  if (p.timestamp !== undefined) {
    writeTag(out, 1, 0);
    writeVarint(out, BigInt(p.timestamp));
  }
  for (const m of p.metrics ?? []) {
    writeLengthDelimited(out, 2, encodeMetric(m));
  }
  if (p.seq !== undefined) {
    writeTag(out, 3, 0);
    writeVarint(out, BigInt(p.seq));
  }
  if (p.extraFields) {
    for (const b of p.extraFields) out.push(b);
  }
  return new Uint8Array(out);
}

/** Build raw bytes for an arbitrary field (unknown-field skip tests). */
export function encodeRawField(
  field: number,
  wireType: number,
  payload: number[] | Uint8Array,
): Uint8Array {
  const out: number[] = [];
  writeTag(out, field, wireType);
  if (wireType === 2) writeVarint(out, BigInt(payload.length));
  for (const b of payload) out.push(b);
  return new Uint8Array(out);
}
