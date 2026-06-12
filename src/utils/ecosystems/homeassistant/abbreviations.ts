/**
 * Home Assistant MQTT discovery abbreviation handling.
 *
 * Real-world discovery configs (zigbee2mqtt-generated especially) use
 * abbreviated keys (stat_t, avty_t, uniq_id, dev) and the `~` base-topic
 * substitution. The tables below cover the keys this app reads; topic-valued
 * keys it does not know by name are still collected via the generic
 * "_t"/"_topic" suffix rule in discovery.ts.
 */

/** Top-level config key abbreviations (subset the parser reads). */
const TOP_LEVEL_ABBREVIATIONS: Record<string, string> = {
  uniq_id: "unique_id",
  obj_id: "object_id",
  dev: "device",
  o: "origin",
  avty: "availability",
  avty_t: "availability_topic",
  avty_mode: "availability_mode",
  pl_avail: "payload_available",
  pl_not_avail: "payload_not_available",
  dev_cla: "device_class",
  stat_cla: "state_class",
  unit_of_meas: "unit_of_measurement",
  stat_t: "state_topic",
  cmd_t: "command_topic",
  json_attr_t: "json_attributes_topic",
  ent_cat: "entity_category",
  cmps: "components",
  p: "platform",
};

/** Device-block key abbreviations. */
const DEVICE_ABBREVIATIONS: Record<string, string> = {
  ids: "identifiers",
  cns: "connections",
  mf: "manufacturer",
  mdl: "model",
  mdl_id: "model_id",
  sw: "sw_version",
  hw: "hw_version",
  sn: "serial_number",
  cu: "configuration_url",
};

/** Availability-list item abbreviations. */
const AVAILABILITY_ABBREVIATIONS: Record<string, string> = {
  t: "topic",
  pl_avail: "payload_available",
  pl_not_avail: "payload_not_available",
  val_tpl: "value_template",
};

/**
 * Return a copy of obj with abbreviated keys expanded per the table.
 * Long-form keys win when both forms are present. Shallow.
 */
function expandKeys(
  obj: Record<string, unknown>,
  table: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const expanded = table[key] ?? key;
    if (!(expanded in out) || expanded === key) out[expanded] = value;
  }
  return out;
}

/** Expand top-level config abbreviations. */
export function expandConfig(raw: Record<string, unknown>): Record<string, unknown> {
  return expandKeys(raw, TOP_LEVEL_ABBREVIATIONS);
}

/** Expand device-block abbreviations. */
export function expandDeviceBlock(raw: Record<string, unknown>): Record<string, unknown> {
  return expandKeys(raw, DEVICE_ABBREVIATIONS);
}

/** Expand an availability-list item's abbreviations. */
export function expandAvailabilityItem(raw: Record<string, unknown>): Record<string, unknown> {
  return expandKeys(raw, AVAILABILITY_ABBREVIATIONS);
}

/**
 * Apply the `~` base-topic substitution: `~` at the start or end of a topic
 * string is replaced with the config's base topic (the `~` key).
 */
export function substituteBase(topic: string, base: string): string {
  if (base === "" || !topic.includes("~")) return topic;
  let out = topic;
  if (out.startsWith("~")) out = base + out.slice(1);
  if (out.endsWith("~")) out = out.slice(0, -1) + base;
  return out;
}
