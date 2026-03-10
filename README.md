# MQTT Topic Visualiser

A browser-based, real-time visualisation of MQTT topic trees, intended to help a user browse and understand their MQTT data in real-time. Connect to any MQTT broker over WebSocket, subscribe with wildcard support, and watch topics come alive as an animated force-directed graph. Easily understand where your traffic is and identify key datatypes.

**No backend required** — the entire application is a static SPA. The MQTT connection runs directly from the user's browser to the broker via WebSocket. You host static files and that's it.

![MQTT Topic Visualiser screenshot](visualiser.png)

## Quick Start

```bash
npm install
npm run dev
```

Open the URL shown by Vite (typically `http://localhost:5173`), enter a WebSocket broker URL (e.g. `ws://localhost:9001`) and a topic filter, then click Connect.

### Build for production

```bash
npm run build
npm run preview    # preview the production build locally
```

The output in `dist/` is a fully static SPA — deploy it to any static hosting (GitHub Pages, Netlify, S3, etc.). Edit `dist/config.json` after building to customise defaults for your deployment without rebuilding.

## Configuration

The app loads `config.json` from the server root on startup. Edit `public/config.json` before building, or `dist/config.json` after building, to customise defaults for your deployment.

All fields are optional — omitted fields use hardcoded defaults. Values saved in the user's browser (localStorage) take precedence over config values.

### Security Warning

**The `password` field in `config.json` is stored in plaintext and served as a static file.** Anyone who can access the hosted site can read it by fetching `config.json` directly. Do not include sensitive credentials unless the deployment is on a private network or behind authentication.

### Available Options

| Field | Type | Default | Description |
|---|---|---|---|
| `topicFilter` | string | `"robot/#"` | Default MQTT subscription filter |
| `clientId` | string \| null | `null` | Fixed MQTT client ID. When set to a string, the ID is locked and cannot be changed by the user. When `null`, a random ID is generated. |
| `username` | string | `""` | Default username |
| `password` | string | `""` | Default password (**see security warning above**) |
| `autoconnect` | boolean | `false` | Connect automatically on page load |
| `brokers` | array | *(see below)* | List of brokers for the Quick Connect dropdown. Each entry has `name` (string) and `url` (string). Omit or set to `[]` to hide the dropdown. |
| `emaTau` | number | `5` | EMA time constant in seconds |
| `showLabels` | boolean | `true` | Show or hide node labels |
| `labelDepthFactor` | number | `5` | Label depth visibility factor |
| `labelMode` | `"zoom"` \| `"depth"` | `"zoom"` | Label visibility mode: zoom-based fade or fixed depth cutoff |
| `labelFontSize` | number | `14` | Base label font size in pixels (max size when depth scaling is on) |
| `scaleTextByDepth` | boolean | `true` | Scale label text size inversely with tree depth |
| `showTooltips` | boolean | `true` | Show hover tooltips on nodes with topic details |
| `nodeScale` | number | `1.0` | Node radius multiplier (0.5–4.0). Scales all nodes proportionally |
| `scaleNodeSizeByDepth` | boolean | `false` | Scale node display radius inversely with tree depth |
| `ancestorPulse` | boolean | `true` | Pulse parent nodes on descendant messages |
| `showRootPath` | boolean | `false` | Show structural ancestor nodes above subscription prefix |
| `repulsionStrength` | number | `-350` | Node repulsion force |
| `linkDistance` | number | `155` | Ideal parent-child link distance (px) |
| `linkStrength` | number | `0.5` | Link rigidity (0-1) |
| `collisionPadding` | number | `13` | Extra collision gap around nodes (px) |
| `alphaDecay` | number | `0.01` | Simulation settle speed |
| `settingsCollapsed` | boolean | `false` | Start with settings panel collapsed |
| `connectionCollapsed` | boolean | `false` | Start with connection panel collapsed |
| `webmcpEnabled` | boolean | `true` | Enable WebMCP tool registration for browser AI agents. Set to `false` to disable. |
| `description` | string \| null | *(see below)* | Description shown in the connection panel below the title when expanded. Set to `""` to hide. Omit or set to `null` to use the built-in default. |

### Precedence

For any given setting, the resolution order is:

1. **URL query params** (`?broker=...&topic=...`) — highest priority, one-time override for `brokerUrl` and `topicFilter` only (not persisted)
2. **localStorage** (user's previous session)
3. **config.json** (deployment defaults)
4. **Hardcoded defaults** — lowest priority

**Exception:** when `clientId` is set to a non-null string in `config.json`, it is always used regardless of localStorage. This is intended for deployments that require a specific client identity.

### Example

```json
{
  "brokerUrl": "wss://my-broker.example.com:8884/mqtt",
  "topicFilter": "sensors/#",
  "autoconnect": true,
  "settingsCollapsed": true,
  "connectionCollapsed": true,
  "repulsionStrength": -400,
  "linkDistance": 120
}
```

This would configure the app to auto-connect to a custom broker on load with both panels collapsed and a wider graph layout. The user can still change settings in the UI — their changes persist in localStorage and take priority on subsequent visits.

### Brokers (Quick Connect)

The `brokers` array populates the "Quick Connect" dropdown in the connection panel. Selecting a broker fills the URL field and shows the broker's brand icon (bundled SVG icons for HiveMQ, Mosquitto, EMQX, and a generic MQTT icon for others). The user still clicks Connect manually. The default `config.json` ships with three public brokers (HiveMQ, EMQX, Mosquitto). To customise for your deployment:

```json
{
  "brokers": [
    { "name": "Internal Broker", "url": "wss://mqtt.internal.example.com/mqtt" },
    { "name": "HiveMQ", "url": "wss://broker.hivemq.com:8884/mqtt" }
  ]
}
```

To hide the dropdown entirely, set `"brokers": []` or omit the field.

### WebMCP Integration

The app registers tools with the browser's [WebMCP API](https://webmachinelearning.github.io/webmcp/) (`navigator.modelContext`), enabling browser-integrated AI agents to query the MQTT topic tree and traffic data. Requires Chrome 146+ with the WebMCP flag enabled. Gracefully no-ops on unsupported browsers.

**Available tools:**

| Tool | Description |
|---|---|
| `getTopicTree` | Get the topic tree structure (capped at `maxDepth`, default 5) |
| `getActiveTopics` | List topics currently receiving messages, sorted by direct rate |
| `getNoisyTopics` | List highest-traffic subtrees, ranked by aggregate rate |
| `findTopics` | Search topics by substring pattern with optional rate/depth filters |
| `getTopicDetails` | Get full details for a specific topic (rate, payload, QoS, payload sizes, etc.) |
| `getLargestPayloads` | List topics ranked by all-time largest payload size; supports `limit` and `minSize` filters. Size tracking is unconditional — recorded even when tooltips are off or the payload has been LRU-evicted |
| `getStats` | Session statistics: total messages, topics, uptime, top 10 active |
| `exportGraph` | Trigger a PNG export of the graph |
| `highlightNodes` | Highlight nodes with a coloured ring; replaces existing highlights |
| `clearHighlights` | Remove all highlight rings |

All query tools are marked `readOnlyHint: true`. To disable WebMCP registration entirely, set `"webmcpEnabled": false` in `config.json`.

## Performance Profiling

The app includes a `?perf` debug mode and a Playwright-based profiler script for automated data collection.

```bash
# Start the app, then in a second terminal:
npm run perf -- --broker wss://test.mosquitto.org:8081 --topic "test/#" --duration 60 --output report.json
```

The profiler connects to the running app via a headless Chromium browser, fills in the connection form, collects `[PERF:SUMMARY]` console output and long-frame traces, then writes a structured JSON report. Add `--headed` to watch it run in a real browser window.

See **[docs/performance-profiling.md](docs/performance-profiling.md)** for full usage, all CLI options, report field definitions, bottleneck diagnosis guidance, and known scale limits.

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 18 + TypeScript (strict) |
| Build | Vite 5 |
| Styling | Tailwind CSS v3 |
| Visualisation | D3.js v7 (force simulation, SVG) |
| MQTT | mqtt.js v5 (browser WebSocket bundle, MQTT v5 protocol) |
| Maps | Leaflet + OpenStreetMap tiles (Insights Drawer) |
| State | Zustand v5 |
| Deploy | Static SPA |

## Project Structure

```
public/
  config.json              # Deployment configuration (copied to dist/ on build)
src/
  types/
    index.ts               # TopicNode, GraphNode, GraphLink, ConnectionParams, Particle, MqttUserProperties
    payloadTags.ts          # Payload tag types, detector results, GeoMetadata, GeoNode, TrailPoint, worker protocol
    webmcp.d.ts            # Ambient type declarations for W3C WebMCP API
  stores/
    topicStore.ts           # Zustand store: topic tree, EMA rates, decay, settings
  hooks/
    useMqttClient.ts        # MQTT lifecycle hook, localStorage persistence
  services/
    mqttService.ts          # mqtt.js WebSocket wrapper (MQTT v5); connection log ring buffer, retry cap (3 attempts), structured error type
    payloadAnalyzerService.ts # Web Worker lifecycle manager for off-thread payload analysis
    webMcpService.ts        # WebMCP tool registration (navigator.modelContext)
  workers/
    payloadAnalyzer.worker.ts # Web Worker: runs payload detectors off the main thread
  components/
    ConnectionPanel.tsx     # Broker URL, topic filter, client ID, auth, connect/disconnect
    TopicGraph.tsx          # SVG container, syncs store state to GraphRenderer
    GraphRenderer.ts        # D3 force simulation, nodes/links/labels/effects/particles
    DetailPanel.tsx         # Selected node detail panel (topic path, stats, payload)
    InsightsDrawer.tsx      # Slide-out Leaflet map panel with trails, pin, multi-geo mode
    NodeTooltip.tsx         # Hover tooltip for node details
    SettingsPanel.tsx       # Sliders, toggles, collapsible sections, portal tooltips
    StatusBar.tsx           # Message/topic counts, uptime
  utils/
    config.ts              # Config loader: fetch config.json, AppConfig interface
    topicParser.ts          # Topic string parsing, tree operations, ancestor paths, collectGeoNodes
    sizeCalculator.ts       # Logarithmic node radius from aggregate rate
    colorScale.ts           # Custom multi-stop colour scale (slate > sky > orange > amber > yellow)
    formatters.ts           # Rate/timestamp/size formatting, payload truncation, depth scaling
    brokerIcons.ts          # Bundled SVG broker icons (Simple Icons, CC0) + domain matching
    connectionErrors.ts     # Connection error diagnosis: maps raw errors to actionable hints + log timestamp formatter
    perfDebug.ts            # Performance debug module (?perf URL param activation)
    detectors/
      geoDetector.ts        # Geo coordinate detection (lat/lon key pairs + GeoJSON Point)
      imageDetector.ts      # JPEG/PNG detection from magic-byte signatures in UTF-8-decoded strings
```

## How It Works

### Topic Tree

MQTT topics are `/`-delimited (e.g. `home/kitchen/temp`). Each segment becomes a node in a tree. Parent nodes are created implicitly — even if no message was ever published directly to `home/`, the node exists as an ancestor.

### Rate Tracking

Message frequency uses an Exponential Moving Average with a configurable time constant (default 5s). A decay timer runs every 500ms, smoothing rates and decaying idle topics toward zero.

### Aggregate Rates

Each node's aggregate rate = its own message rate + the sum of all children's aggregate rates, propagated bottom-up after each decay tick. Parent nodes reflect the total activity of their entire subtree.

### Node Sizing

Radius follows a logarithmic scale to prevent high-frequency topics from dominating:

```
radius = MIN_R + (MAX_R - MIN_R) * (log(1 + aggregateRate) / log(1 + MAX_RATE))
```

Size changes are smoothly interpolated via an exponential lerp in the 60fps animation loop, preventing jumpy resizing on message bursts or decay ticks.

### D3 + React Integration

React owns the `<svg>` container element. D3 manages the force simulation and directly manipulates SVG elements inside it via a ref. Individual graph elements (circles, lines, text) are not React-rendered — D3 handles them for performance.

## Hosting Notes

This is a purely client-side application. The hosted files are static HTML, CSS, and JS. All MQTT connections happen directly between the user's browser and whatever broker they configure.

**Mixed content**: GitHub Pages (and most static hosts) serve over HTTPS. Browsers block mixed content, so users will only be able to connect to `wss://` brokers, not plain `ws://`. This is a browser security restriction, not an application limitation.

**Self-hosted with HTTPS**: If you serve this app over HTTPS but your MQTT broker only supports plain WebSocket (`ws://`), you need a reverse proxy to bridge the protocols. Add a WebSocket proxy location to your nginx config:

```nginx
location /mqtt_ws/ {
    proxy_pass http://your-broker-host:9001/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400;
}
```

Then set `brokerUrl` in `config.json` to `wss://your-https-host/mqtt_ws/`. The browser connects via `wss://` to nginx, which upgrades the connection and proxies to the broker over plain `ws://`.

**Customising a deployment**: Edit `config.json` in the deployed `dist/` directory (or `public/config.json` before building) to set broker defaults, enable autoconnect, collapse panels, or lock the client ID for your specific use case.

## Acknowledgement

This project was built with [OpenCode](https://opencode.ai) and Claude Opus 4 (`claude-opus-4-6`) by Anthropic.

## License

MIT
