/**
 * Sparkplug B metric datatype codes (org.eclipse.tahu.protobuf DataType enum).
 * Codes 16+ are complex types this app does not decode (value stays null).
 */
const DATATYPE_NAMES: Record<number, string> = {
  0: "Unknown",
  1: "Int8",
  2: "Int16",
  3: "Int32",
  4: "Int64",
  5: "UInt8",
  6: "UInt16",
  7: "UInt32",
  8: "UInt64",
  9: "Float",
  10: "Double",
  11: "Boolean",
  12: "String",
  13: "DateTime",
  14: "Text",
  15: "UUID",
  16: "DataSet",
  17: "Bytes",
  18: "File",
  19: "Template",
};

/** Human-readable name for a Sparkplug datatype code. */
export function datatypeName(code: number): string {
  return DATATYPE_NAMES[code] ?? `Type${code}`;
}

/** Signed integer datatypes whose int_value/long_value need sign reinterpretation. */
export const SIGNED_INT_TYPES = new Set([1, 2, 3]); // Int8, Int16, Int32
export const SIGNED_LONG_TYPE = 4; // Int64
