# Performance Profiling

The visualiser ships with a Playwright-based profiler that automates the manual "open browser → connect → wait → copy console" workflow. It collects the built-in `?perf` instrumentation output and CDP metrics into a structured JSON report.

## Prerequisites

- The app must already be running (`npm run dev` or `npm run preview`)
- Dependencies are installed automatically with `npm install` (Playwright and tsx are dev dependencies)
- On first use, install the Chromium browser: `npx playwright install chromium`

## Usage

```bash
# Basic — 30 second run against the default local dev server
npm run perf -- --broker wss://test.mosquitto.org:8081 --topic "test/#"

# Longer run, save report to file
npm run perf -- --broker wss://test.mosquitto.org:8081 --topic "homeassistant/#" --duration 60 --output report.json

# Watch it run in a real browser window
npm run perf -- --broker wss://my-broker.internal:8081 --topic "sensors/#" --headed

# Against a production build (npm run preview)
npm run perf -- --broker wss://test.mosquitto.org:8081 --topic "test/#" --url http://localhost:4173
```

### Options

| Option | Default | Description |
|---|---|---|
| `--broker <url>` | *(required)* | MQTT broker WebSocket URL |
| `--topic <filter>` | `#` | Topic filter to subscribe to |
| `--duration <sec>` | `30` | Collection duration in seconds |
| `--url <url>` | `http://localhost:5173` | App URL (change for `npm run preview`) |
| `--output <path>` | stdout | Write JSON report to file instead of stdout |
| `--headed` | headless | Show a real browser window during collection |
| `--help` | — | Print usage |

## Report format

```json
{
  "broker": "wss://test.mosquitto.org:8081",
  "topic": "homeassistant/#",
  "duration": 60,
  "collectedAt": "2026-03-04T21:29:24.161Z",
  "summaries": [ ... ],
  "longFrames": [ ... ],
  "cdpMetrics": { ... },
  "summary": { ... }
}
```

### `summaries`

One entry per 5-second interval (emitted by the `?perf` instrumentation):

| Field | Description |
|---|---|
| `fps` | Frames per second in this interval |
| `frameMs` | Average time spent in the animation loop per frame (ms) |
| `d3TickMs` | Average time for D3 simulation tick (node/link position updates) per frame |
| `nodeColorMs` | Average time for node colour/pulse/ring updates per frame |
| `decayTickMs` | Time for the last EMA decay pass (runs every 500ms) |
| `nodeCount` | Number of graph nodes at sample time |
| `linkCount` | Number of graph links at sample time |
| `activeNodes` | Nodes currently in a pulse fade cycle (receiving per-frame colour updates) |
| `particles` | Live particle count |
| `heapMB` | JS heap used (Chrome only; `null` on other browsers) |

### `longFrames`

One entry per long-animation-frame or longtask event (any frame >50ms). Long-animation-frame entries include script attribution:

```json
{
  "type": "long-animation-frame",
  "duration": 329.4,
  "blockingDuration": 276.2,
  "scripts": [
    { "invoker": "TimerHandler:setInterval", "fn": "", "duration": 15, "src": "topicStore.ts" },
    { "invoker": "FrameRequestCallback",     "fn": "animate",           "duration": 84, "src": "GraphRenderer.ts" },
    { "invoker": "FrameRequestCallback",     "fn": "wake",              "duration": 69, "src": "d3.js" }
  ]
}
```

`blockingDuration` is the portion of the frame that blocked user input. Script entries show which source file and function caused the work.

### `cdpMetrics`

A snapshot of Chrome DevTools Protocol performance metrics taken at the end of the run:

| Field | Description |
|---|---|
| `JSHeapUsedSize` | JS heap bytes currently in use |
| `JSHeapTotalSize` | Total JS heap size allocated |
| `Nodes` | Total DOM node count |
| `LayoutCount` | Number of layout passes triggered |
| `RecalcStyleCount` | Number of style recalculations |
| `LayoutDuration` | Total time spent in layout (seconds) |
| `RecalcStyleDuration` | Total time spent in style recalc (seconds) |
| `ScriptDuration` | Total time spent executing scripts (seconds) |
| `TaskDuration` | Total time spent in all tasks (seconds) |

### `summary`

Pre-computed aggregates over the full run:

| Field | Description |
|---|---|
| `summaryCount` | Number of 5-second summary intervals collected |
| `longFrameCount` | Total long-frame/longtask events observed |
| `avgFps` | Mean FPS across all intervals |
| `avgFrameMs` | Mean frame time across all intervals |
| `avgNodeCount` | Mean node count across all intervals |
| `maxHeapMB` | Peak heap usage observed |

## Interpreting results

### FPS thresholds

| FPS | Verdict |
|---|---|
| 55–60 | Healthy |
| 40–55 | Acceptable — some overhead, worth investigating |
| 20–40 | Degraded — likely a specific bottleneck |
| < 20 | Severe — users will notice |

### Key bottleneck signals

**`d3TickMs` > 5ms**
The D3 force simulation tick is too slow. At 2,000+ nodes, the O(n²) `forceManyBody` calculation dominates. Mitigations: reduce `alphaDecay` to let the simulation settle faster, raise `alphaMin` to stop it sooner, or switch to Canvas rendering (issue #19) which avoids per-node DOM attribute writes.

**`nodeColorMs` > 2ms**
The pulse fade / colour update loop is touching too many nodes. This scales with `activeNodes` — a large initial burst (many nodes pulsing simultaneously) is normal and transient. If it stays high after the burst, investigate the `activeNodeIds` set management.

**`decayTickMs` > 5ms**
The EMA decay walk is slow. This is O(n) over the full topic tree and runs every 500ms. At 2,000+ nodes it starts to compete with the animation frame. Mitigation: issue #24 (batch node creation) would reduce the peak tree size by coalescing the initial flood.

**`longFrames` with `d3.js:wake` in the script list**
The D3 simulation is still running (alpha > alphaMin) and taking time every frame. This compounds with everything else. The simulation reheats on every structural change (`alpha(0.3).restart()` in `update()`). Avoid calling `update()` unnecessarily — the `graphStructureVersion` gate in TopicGraph prevents most spurious calls, but a burst of new nodes will keep reheating the simulation.

**`longFrames` with `GraphRenderer.ts:animate` growing over time**
The animation loop itself is getting slower as node count grows — this is the SVG DOM write cost. Each tick sets `cx`, `cy` on every node circle and `x1`, `y1`, `x2`, `y2` on every link line. At 2,741 nodes that's ~5,500 DOM attribute writes per frame. The fix is Canvas rendering (issue #19).

**`heapMB` growing across summaries**
Memory leak. Check for unbounded Maps or Sets (the `lastPulseTimestamps` map, `activeNodeIds` set, payload LRU). These are bounded by design — if heap is growing, something else is accumulating.

### Known scale limits

Based on profiling with `homeassistant/#` on test.mosquitto.org (2,741 nodes):

| Metric | Observed |
|---|---|
| Avg FPS | 7–9 (severe) |
| `d3TickMs` | 33–41ms (2.5× the frame budget alone) |
| Long frames | Continuous, up to 329ms |
| `GraphRenderer:animate` | 8–84ms, growing with simulation activity |
| `d3:wake` | 14–93ms, the dominant cost |
| Heap | 18–22MB flat (no leak) |

The app degrades severely above ~1,000 nodes in its current SVG rendering mode. Issue #19 (Canvas rendering) is the primary fix for this scale.

## Known issues with the profiler itself

- Long-frame entries appear **doubled** in the output — this is a known Chromium behaviour where the PerformanceObserver fires once buffered and once live for the same frame. When counting unique long frames, divide `longFrameCount` by 2.
- The `PerformanceObserverCallback` itself appears in some long-frame traces (attributed to `perfDebug.ts`). This is the profiler observing its own observation — it adds ~10–50ms overhead in very active sessions. This overhead is not present in production builds without `?perf`.
- CDP metrics are a snapshot at collection end, not a time series. For trending, compare multiple runs.
