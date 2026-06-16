import type { DomainEntity } from "../../types/entities";
import { ensureEntity, type EntityRegistry } from "./entityOps";

/**
 * Tasmota — ESP8266/ESP32 smart-device firmware, structural (tier-3) provider.
 *
 * Tasmota publishes under a `%prefix%/%topic%/` scheme; in the default layout
 * that's `(tele|stat|cmnd)/<device>/<LEAF>`:
 *   tele/<device>/LWT          Online / Offline (availability)
 *   tele/<device>/STATE        periodic status JSON (Uptime, Heap, POWER, Wifi…)
 *   tele/<device>/SENSOR       sensor JSON
 *   tele/<device>/INFO1        {"Info1":{"Module":…, "Version":…}}
 *   stat/<device>/RESULT|POWER  command results / relay state
 *
 * Entities are flat devices keyed by the `<device>` segment (its tele/stat/cmnd
 * topics share it, so they group under one entity). Detection gates on the
 * Tasmota leaf vocabulary to avoid claiming arbitrary `tele/`/`stat/` traffic.
 * (Tasmota with SetOption19 also emits HA discovery and may surface via the
 * Home Assistant provider too — an accepted minor double-claim.)
 */

const PREFIXES = new Set(["tele", "stat", "cmnd"]);
const TASMOTA_LEAVES = new Set([
  "LWT", "STATE", "SENSOR", "RESULT", "STATUS", "INFO1", "INFO2", "INFO3",
  "UPTIME", "MARGINS", "ENERGY",
]);

/** True for a standard Tasmota telemetry/command leaf. */
function isTasmotaLeaf(leaf: string): boolean {
  return TASMOTA_LEAVES.has(leaf) || /^POWER\d?$/.test(leaf) || /^STATUS\d{1,2}$/.test(leaf);
}

const deviceKey = (device: string) => `tasmota:dev:${device}`;

/** Result of recording one Tasmota message: entity to tag + change flag. */
export interface TasmotaHit {
  entity: DomainEntity;
  changed: boolean;
}

/**
 * Main-thread hook: a message that might be Tasmota. Derives the device from
 * `(tele|stat|cmnd)/<device>/<leaf>`, binds the node, flips online on LWT, and
 * reads module/version from INFO1. Returns null for non-Tasmota topics.
 */
export function recordTasmotaMessage(
  registry: EntityRegistry,
  topic: string,
  nodeId: string,
  payload: string,
): TasmotaHit | null {
  const segments = topic.split("/");
  if (segments.length < 3 || !PREFIXES.has(segments[0])) return null;
  const device = segments[1];
  const leaf = segments[2];
  if (!device) return null;

  // A standard leaf identifies the device; once it's known, any topic under
  // the same device (incl. custom rule topics) groups under it.
  const known = registry.entities.has(deviceKey(device));
  if (!known && !isTasmotaLeaf(leaf)) return null;

  const result = ensureEntity(registry, {
    key: deviceKey(device),
    ecosystem: "tasmota",
    role: "device",
    label: device,
    parentKey: null,
  });
  if (!result) return null;
  const dev = result.entity;
  let changed = result.created;

  if (!dev.topicNodeIds.has(nodeId)) {
    (dev.topicNodeIds as Set<string>).add(nodeId);
    changed = true;
  }
  // Anchor on the periodic STATE telemetry when we can; else first-seen.
  const isState = segments[0] === "tele" && leaf === "STATE";
  if (isState) {
    if (dev.anchorTopicId !== nodeId) {
      dev.anchorTopicId = nodeId;
      changed = true;
    }
  } else if (dev.anchorTopicId === null) {
    dev.anchorTopicId = nodeId;
    changed = true;
  }

  // Availability from the LWT.
  if (leaf === "LWT") {
    const online = payload === "Online" ? true : payload === "Offline" ? false : dev.online;
    if (online !== dev.online) {
      dev.online = online;
      changed = true;
    }
  }

  // Module / firmware version from INFO1.
  if (leaf === "INFO1") {
    try {
      const parsed = JSON.parse(payload) as { Info1?: { Module?: unknown; Version?: unknown } };
      const info = parsed?.Info1;
      const module = typeof info?.Module === "string" ? info.Module : null;
      const version = typeof info?.Version === "string" ? info.Version : null;
      if (module && dev.attributes.module !== module) {
        dev.attributes.module = module;
        changed = true;
      }
      if (version && dev.attributes.version !== version) {
        dev.attributes.version = version;
        changed = true;
      }
    } catch {
      // non-JSON INFO1 — ignore
    }
  }

  return { entity: dev, changed };
}
