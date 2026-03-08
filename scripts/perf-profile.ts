#!/usr/bin/env tsx
/**
 * MQTT Visualiser — Playwright performance profiler
 *
 * Automates the manual "open browser → connect → wait → copy console" workflow.
 * Requires the app to already be running (npm run dev or npm run preview).
 *
 * Usage:
 *   npm run perf -- [options]
 *   npx tsx scripts/perf-profile.ts [options]
 *
 * Options:
 *   --broker   <url>   MQTT broker WebSocket URL (required)
 *   --topic    <str>   Topic filter to subscribe to (default: "#")
 *   --duration <sec>   Collection duration in seconds (default: 30)
 *   --url      <url>   App URL (default: http://localhost:5173)
 *   --output   <path>  Write JSON report to file instead of stdout
 *   --headed           Run with a visible browser window (default: headless)
 *   --help             Show this help text
 *
 * Example:
 *   npm run perf -- --broker wss://test.mosquitto.org:8081 --topic "test/#" --duration 60
 */

import { chromium } from "playwright";
import { writeFileSync } from "fs";

// ── CLI argument parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  broker: string;
  topic: string;
  duration: number;
  appUrl: string;
  output: string | null;
  headed: boolean;
  help: boolean;
} {
  const args = argv.slice(2); // drop "node" and script path
  const result = {
    broker: "",
    topic: "#",
    duration: 30,
    appUrl: "http://localhost:5173",
    output: null as string | null,
    headed: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--broker":   result.broker  = args[++i] ?? ""; break;
      case "--topic":    result.topic   = args[++i] ?? "#"; break;
      case "--duration": result.duration = Number(args[++i]) || 30; break;
      case "--url":      result.appUrl  = args[++i] ?? result.appUrl; break;
      case "--output":   result.output  = args[++i] ?? null; break;
      case "--headed":   result.headed  = true; break;
      case "--help":     result.help    = true; break;
    }
  }

  return result;
}

function printHelp(): void {
  console.error(`
mqtt-vis perf profiler

Usage:
  npm run perf -- [options]

Options:
  --broker   <url>   MQTT broker WebSocket URL  (required)
  --topic    <str>   Topic filter               (default: "#")
  --duration <sec>   Collection duration        (default: 30)
  --url      <url>   App URL                    (default: http://localhost:5173)
  --output   <path>  Write report to file       (default: stdout)
  --headed           Show browser window        (default: headless)
  --help             Show this help

Example:
  npm run perf -- --broker wss://test.mosquitto.org:8081 --topic "test/#" --duration 60
`.trim());
}

// ── Types for the collected data ────────────────────────────────────────────

interface PerfSummary {
  fps: number;
  frameMs: number;
  d3TickMs: number;
  nodeColorMs: number;
  decayTickMs: number;
  nodeCount: number;
  linkCount: number;
  activeNodes: number;
  heapMB: number | null;
}

interface LongFrame {
  type: string;
  duration: number;
  blockingDuration?: number;
  scripts?: Array<{
    invoker: string;
    fn: string;
    duration: number;
    src: string;
  }>;
}

interface CdpMetrics {
  JSHeapUsedSize: number;
  JSHeapTotalSize: number;
  Nodes: number;
  LayoutCount: number;
  RecalcStyleCount: number;
  LayoutDuration: number;
  RecalcStyleDuration: number;
  ScriptDuration: number;
  TaskDuration: number;
}

interface PerfReport {
  broker: string;
  topic: string;
  appUrl: string;
  duration: number;
  collectedAt: string;
  summaries: PerfSummary[];
  longFrames: LongFrame[];
  cdpMetrics: Partial<CdpMetrics> | null;
  summary: {
    summaryCount: number;
    longFrameCount: number;
    avgFps: number | null;
    avgFrameMs: number | null;
    avgNodeCount: number | null;
    maxHeapMB: number | null;
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
}

function max(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length > 0 ? Math.max(...nums) : null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.broker) {
    console.error("Error: --broker is required\n");
    printHelp();
    process.exit(1);
  }

  const { broker, topic, duration, appUrl, output, headed } = args;

  console.error(`[perf] Connecting to app at ${appUrl}`);
  console.error(`[perf] Broker: ${broker}`);
  console.error(`[perf] Topic:  ${topic}`);
  console.error(`[perf] Duration: ${duration}s`);
  console.error(`[perf] Mode: ${headed ? "headed" : "headless"}`);
  console.error("");

  const summaries: PerfSummary[] = [];
  const longFrames: LongFrame[] = [];

  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Intercept console messages from the app
  page.on("console", (msg) => {
    const text = msg.text();

    if (text.startsWith("[PERF:SUMMARY]")) {
      const json = text.slice("[PERF:SUMMARY]".length).trim();
      try {
        const parsed = JSON.parse(json) as PerfSummary;
        summaries.push(parsed);
        // Mirror to stderr so the user sees live progress
        console.error(`[perf] +summary  fps=${parsed.fps}  nodes=${parsed.nodeCount}  frameMs=${parsed.frameMs}  heapMB=${parsed.heapMB ?? "n/a"}`);
      } catch {
        // Malformed — skip
      }
    } else if (text.startsWith("[PERF:LONG_FRAME]")) {
      const json = text.slice("[PERF:LONG_FRAME]".length).trim();
      try {
        const parsed = JSON.parse(json) as LongFrame;
        longFrames.push(parsed);
        console.error(`[perf] ! LONG_FRAME  duration=${parsed.duration}ms  blocking=${parsed.blockingDuration ?? "n/a"}ms`);
      } catch {
        // Malformed — skip
      }
    }
  });

  // Navigate to the app with ?perf to activate instrumentation
  const targetUrl = `${appUrl}?perf`;
  console.error(`[perf] Navigating to ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: "networkidle" });

  // Expand the ConnectionPanel if it is collapsed (it auto-collapses on node select,
  // and may be collapsed by default via config). The toggle button shows the current
  // connection status text — click it only if the form fields are not visible.
  const brokerInput = page.locator('input[placeholder="wss://broker.example.com:8884/mqtt"]');
  const isVisible = await brokerInput.isVisible();
  if (!isVisible) {
    // Click the status/collapse toggle button to expand the panel
    const toggleBtn = page.locator('button[type="button"]').first();
    await toggleBtn.click();
    await page.waitForTimeout(200);
  }

  // Fill broker URL using the stable placeholder attribute
  await brokerInput.fill(broker);

  // Fill topic filter using its placeholder
  await page.locator('input[placeholder="#"]').fill(topic);

  // Click the Connect submit button inside the form — scoped to avoid ambiguity
  // with tab buttons or status indicators that also contain the text "Connect".
  const connectBtn = page.locator('form button[type="submit"]');
  await connectBtn.click();
  console.error("[perf] Clicked Connect — waiting for data...");

  // Wait for connection (look for status indicator changing, or just wait briefly)
  await page.waitForTimeout(2000);

  // Collect for the specified duration
  console.error(`[perf] Collecting for ${duration}s...`);
  await page.waitForTimeout(duration * 1000);

  // Grab CDP Performance metrics snapshot
  let cdpMetrics: Partial<CdpMetrics> | null = null;
  try {
    const cdpSession = await context.newCDPSession(page);
    await cdpSession.send("Performance.enable");
    const { metrics } = await cdpSession.send("Performance.getMetrics");
    cdpMetrics = {};
    const keys: (keyof CdpMetrics)[] = [
      "JSHeapUsedSize",
      "JSHeapTotalSize",
      "Nodes",
      "LayoutCount",
      "RecalcStyleCount",
      "LayoutDuration",
      "RecalcStyleDuration",
      "ScriptDuration",
      "TaskDuration",
    ];
    for (const { name, value } of metrics) {
      if (keys.includes(name as keyof CdpMetrics)) {
        (cdpMetrics as Record<string, number>)[name] = value;
      }
    }
    await cdpSession.detach();
  } catch (err) {
    console.error(`[perf] CDP metrics unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }

  await browser.close();

  // Build aggregate summary stats
  const report: PerfReport = {
    broker,
    topic,
    appUrl,
    duration,
    collectedAt: new Date().toISOString(),
    summaries,
    longFrames,
    cdpMetrics,
    summary: {
      summaryCount: summaries.length,
      longFrameCount: longFrames.length,
      avgFps: avg(summaries.map((s) => s.fps)),
      avgFrameMs: avg(summaries.map((s) => s.frameMs)),
      avgNodeCount: avg(summaries.map((s) => s.nodeCount)),
      maxHeapMB: max(summaries.map((s) => s.heapMB)),
    },
  };

  const json = JSON.stringify(report, null, 2);

  if (output) {
    writeFileSync(output, json, "utf8");
    console.error(`\n[perf] Report written to ${output}`);
  } else {
    process.stdout.write(json + "\n");
  }

  console.error("\n[perf] Done.");
  console.error(`  Summaries collected : ${report.summary.summaryCount}`);
  console.error(`  Long frames         : ${report.summary.longFrameCount}`);
  console.error(`  Avg FPS             : ${report.summary.avgFps ?? "n/a"}`);
  console.error(`  Avg frame ms        : ${report.summary.avgFrameMs ?? "n/a"}`);
  console.error(`  Avg node count      : ${report.summary.avgNodeCount ?? "n/a"}`);
  console.error(`  Max heap MB         : ${report.summary.maxHeapMB ?? "n/a"}`);
}

main().catch((err) => {
  console.error("[perf] Fatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
