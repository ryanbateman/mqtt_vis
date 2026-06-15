import type { DomainEntity } from "../../types/entities";
import { ensureEntity, type EntityRegistry } from "./entityOps";

/**
 * OpenDTU — Hoymiles micro-inverter gateway, structural (tier-3) provider.
 *
 * OpenDTU's MQTT prefix is user-configurable (`solar`, `pv`, a custom name,
 * even multi-segment), so detection keys on the inner structure rather than a
 * fixed prefix: a 12-digit Hoymiles inverter serial followed by OpenDTU's
 * vocabulary —
 *   <base>/<serial>/<ch>/<metric>          (ch 0 = AC summary, 1..N = DC strings)
 *   <base>/<serial>/status/<field>         (reachable/producing/last_update/...)
 *   <base>/<serial>/device/<field>         (fwbuildversion/hwversion/...)
 *   <base>/<serial>/name                   (inverter name)
 *   <base>/dtu/<field>                      (the gateway: hostname/ip/...)
 *
 * Entities form a DTU -> inverter tree (the DTU is keyed by the topic prefix
 * before the serial); each inverter's channel/status/device/name topics are
 * its grouped member topics. The serial + vocabulary combination keeps this a
 * low-false-positive heuristic (e.g. AhoyDTU-style `solar/<name>/ac/w` traffic
 * sharing the `solar/` prefix is not claimed).
 */

/** Hoymiles inverter serials are 12 digits starting with 1. */
const HOYMILES_SERIAL = /^1\d{11}$/;
const CHANNEL = /^\d{1,2}$/;

const CHANNEL_METRICS = new Set([
  "power", "voltage", "current", "yieldday", "yieldtotal", "irradiation",
  "frequency", "temperature", "powerfactor", "reactivepower", "efficiency", "name",
]);
const STATUS_FIELDS = new Set([
  "reachable", "producing", "last_update", "limit_relative", "limit_absolute",
]);
const DEVICE_FIELDS = new Set([
  "fwbuildversion", "fwbuilddatetime", "hwpartnumber", "hwversion", "bootloaderversion",
]);
const DTU_FIELDS = new Set([
  "hostname", "ip", "uptime", "rssi", "bssid", "status", "heap",
]);

const dtuKey = (base: string) => `opendtu:dtu:${base}`;
const inverterKey = (serial: string) => `opendtu:inv:${serial}`;

/** Result of recording one OpenDTU message: entity to tag + change flag. */
export interface OpenDtuHit {
  entity: DomainEntity;
  changed: boolean;
}

/** Ensure the DTU gateway entity for a topic base. Null if the cap blocks it. */
function ensureDtu(registry: EntityRegistry, base: string): DomainEntity | null {
  const result = ensureEntity(registry, {
    key: dtuKey(base),
    ecosystem: "opendtu",
    role: "dtu",
    label: base,
    parentKey: null,
  });
  return result?.entity ?? null;
}

/**
 * Main-thread hook: a message that might be OpenDTU. Builds the DTU -> inverter
 * tree from the topic shape, binds the node to its inverter (or the DTU for
 * gateway topics), and tracks online from status/reachable. Returns null for
 * non-OpenDTU topics.
 */
export function recordOpenDtuMessage(
  registry: EntityRegistry,
  topic: string,
  nodeId: string,
  payload: string,
): OpenDtuHit | null {
  const segments = topic.split("/");
  const serialIdx = segments.findIndex((s) => HOYMILES_SERIAL.test(s));

  // --- Gateway topic: <base>/dtu/<field> --------------------------------
  if (serialIdx === -1) {
    const dtuIdx = segments.indexOf("dtu");
    if (dtuIdx <= 0 || !DTU_FIELDS.has(segments[dtuIdx + 1] ?? "")) return null;
    const base = segments.slice(0, dtuIdx).join("/");
    const dtu = ensureDtu(registry, base);
    if (!dtu) return null;
    let changed = false;
    if (segments[dtuIdx + 1] === "hostname" && payload && dtu.label !== payload) {
      dtu.label = payload;
      changed = true;
    }
    if (!dtu.topicNodeIds.has(nodeId)) {
      (dtu.topicNodeIds as Set<string>).add(nodeId);
      changed = true;
    }
    if (dtu.anchorTopicId === null) {
      dtu.anchorTopicId = nodeId;
      changed = true;
    }
    return { entity: dtu, changed };
  }

  // --- Inverter topic: <base>/<serial>/<rest> ---------------------------
  const serial = segments[serialIdx];
  const base = segments.slice(0, serialIdx).join("/");
  const rest = segments.slice(serialIdx + 1);
  if (rest.length === 0 || base.length === 0) return null;

  // Gate on OpenDTU's vocabulary so unrelated 12-digit topics aren't claimed.
  const leaf = segments[segments.length - 1];
  const kind = rest[0];
  let valid = false;
  if (kind === "device") valid = DEVICE_FIELDS.has(rest[1] ?? "");
  else if (kind === "status") valid = STATUS_FIELDS.has(rest[1] ?? "");
  else if (kind === "name" && rest.length === 1) valid = true;
  else if (CHANNEL.test(kind)) valid = CHANNEL_METRICS.has(leaf);
  if (!valid) return null;

  // DTU gateway groups its inverters (created lazily from the shared base).
  const dtu = ensureDtu(registry, base);
  if (!dtu) return null;

  const invResult = ensureEntity(registry, {
    key: inverterKey(serial),
    ecosystem: "opendtu",
    role: "inverter",
    label: serial,
    parentKey: dtuKey(base),
    attributes: { type: "inverter" },
  });
  if (!invResult) return { entity: dtu, changed: false };
  const inv = invResult.entity;
  let changed = invResult.created;

  if (!inv.topicNodeIds.has(nodeId)) {
    (inv.topicNodeIds as Set<string>).add(nodeId);
    changed = true;
  }
  // Anchor on the inverter's AC power (channel 0) when we can; else first-seen.
  const isAcPower = kind === "0" && leaf === "power";
  if (isAcPower) {
    if (inv.anchorTopicId !== nodeId) {
      inv.anchorTopicId = nodeId;
      changed = true;
    }
  } else if (inv.anchorTopicId === null) {
    inv.anchorTopicId = nodeId;
    changed = true;
  }

  // Identity + lifecycle.
  if (kind === "name" && payload && inv.label !== payload) {
    inv.label = payload;
    changed = true;
  }
  if (kind === "status" && rest[1] === "reachable") {
    const online = payload === "1" ? true : payload === "0" ? false : inv.online;
    if (online !== inv.online) {
      inv.online = online;
      changed = true;
    }
  }
  if (kind === "status" && rest[1] === "producing" && inv.attributes.producing !== payload) {
    inv.attributes.producing = payload;
    changed = true;
  }
  if (kind === "device" && (rest[1] === "fwbuildversion" || rest[1] === "hwversion")) {
    if (payload && inv.attributes[rest[1]] !== payload) {
      inv.attributes[rest[1]] = payload;
      changed = true;
    }
  }

  return { entity: inv, changed };
}
