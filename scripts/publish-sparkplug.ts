#!/usr/bin/env tsx
/**
 * MQTT Visualiser — Sparkplug B test publisher
 *
 * Simulates one Sparkplug B edge node with one device for manually testing
 * the visualiser's sparkplug detection and lifecycle rendering:
 *
 *   1. Publishes NBIRTH (edge metrics, names + aliases) and DBIRTH (device).
 *   2. Loops NDATA/DDATA every --interval ms with alias-only metrics and an
 *      incrementing seq.
 *   3. On Ctrl-C publishes NDEATH (which the visualiser cascades to the
 *      device) and disconnects. The MQTT LWT also carries the NDEATH in
 *      case the process dies hard.
 *
 * Usage:
 *   npx tsx scripts/publish-sparkplug.ts [options]
 *
 * Options:
 *   --broker   <url>   Broker URL (default: wss://test.mosquitto.org:8081)
 *   --group    <id>    Sparkplug group ID (default: visualiser-demo)
 *   --edge     <id>    Edge node ID (default: edge1)
 *   --device   <id>    Device ID (default: pump1)
 *   --interval <ms>    DATA publish interval (default: 1000)
 *   --help             Show this help text
 *
 * Subscribe the visualiser to: spBv1.0/<group>/#
 */

import mqtt from "mqtt";
import {
  encodeSparkplugPayload,
  type EncodeMetric,
} from "../src/utils/sparkplug/__tests__/encodeHelper";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (process.argv.includes("--help")) {
  console.log("See file header for usage.");
  process.exit(0);
}

const broker = arg("broker", "wss://test.mosquitto.org:8081");
const group = arg("group", "visualiser-demo");
const edge = arg("edge", "edge1");
const device = arg("device", "pump1");
const intervalMs = Number(arg("interval", "1000"));

const T = {
  nbirth: `spBv1.0/${group}/NBIRTH/${edge}`,
  ndeath: `spBv1.0/${group}/NDEATH/${edge}`,
  ndata: `spBv1.0/${group}/NDATA/${edge}`,
  dbirth: `spBv1.0/${group}/DBIRTH/${edge}/${device}`,
  ddata: `spBv1.0/${group}/DDATA/${edge}/${device}`,
};

let seq = 0;
const nextSeq = () => {
  const s = seq;
  seq = (seq + 1) % 256;
  return s;
};

const now = () => Date.now();

// Edge metrics (Sparkplug datatypes: 10=Double, 11=Boolean, 3=Int32, 12=String)
const edgeMetrics = (full: boolean): EncodeMetric[] => [
  { ...(full ? { name: "Node Control/Temperature" } : {}), alias: 1, datatype: 10, doubleValue: 20 + Math.random() * 5 },
  { ...(full ? { name: "Node Control/Uptime" } : {}), alias: 2, datatype: 3, intValue: Math.floor(process.uptime()) },
  { ...(full ? { name: "Node Control/Healthy" } : {}), alias: 3, datatype: 11, booleanValue: true },
];

const deviceMetrics = (full: boolean): EncodeMetric[] => [
  { ...(full ? { name: "Flow Rate" } : {}), alias: 10, datatype: 10, doubleValue: 100 + Math.random() * 20 },
  { ...(full ? { name: "Valve Open" } : {}), alias: 11, datatype: 11, booleanValue: Math.random() > 0.3 },
  { ...(full ? { name: "Mode" } : {}), alias: 12, datatype: 12, stringValue: "AUTO" },
];

const deathPayload = () =>
  Buffer.from(encodeSparkplugPayload({
    timestamp: now(),
    metrics: [{ name: "bdSeq", datatype: 4, longValue: 0n }],
  }));

const client = mqtt.connect(broker, {
  protocolVersion: 4,
  clean: true,
  will: { topic: T.ndeath, payload: deathPayload(), qos: 0, retain: false },
});

client.on("error", (err) => {
  console.error("MQTT error:", err.message);
});

client.on("connect", () => {
  console.log(`Connected to ${broker}`);
  console.log(`Publishing as group="${group}" edge="${edge}" device="${device}"`);
  console.log(`Visualiser topic filter: spBv1.0/${group}/#`);

  seq = 0;
  client.publish(T.nbirth, Buffer.from(encodeSparkplugPayload({
    timestamp: now(), seq: nextSeq(), metrics: edgeMetrics(true),
  })));
  client.publish(T.dbirth, Buffer.from(encodeSparkplugPayload({
    timestamp: now(), seq: nextSeq(), metrics: deviceMetrics(true),
  })));
  console.log("Published NBIRTH + DBIRTH, streaming DATA (Ctrl-C to publish NDEATH and exit)");

  setInterval(() => {
    client.publish(T.ndata, Buffer.from(encodeSparkplugPayload({
      timestamp: now(), seq: nextSeq(), metrics: edgeMetrics(false),
    })));
    client.publish(T.ddata, Buffer.from(encodeSparkplugPayload({
      timestamp: now(), seq: nextSeq(), metrics: deviceMetrics(false),
    })));
  }, intervalMs);
});

process.on("SIGINT", () => {
  console.log("\nPublishing NDEATH and disconnecting…");
  client.publish(T.ndeath, deathPayload(), {}, () => {
    client.end(false, {}, () => process.exit(0));
  });
  setTimeout(() => process.exit(0), 2000);
});
