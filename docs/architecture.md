# Architecture

MQTT Topic Visualiser is a client-side React SPA that connects to an MQTT broker over WebSocket, builds a hierarchical topic tree from incoming messages, and renders the tree as an animated force-directed graph using D3.js. There is no backend — the browser talks directly to the broker.

## Data Flow

The core data pipeline is:

```
MQTT Broker
  → mqttService.ts (WebSocket connection, message reception)
    → useMqttClient.ts (React hook, wires service to store)
      → topicStore.ts (Zustand store: tree structure, rates, decay, settings)
        → TopicGraph.tsx (React container, syncs store to renderer)
          → GraphRenderer.ts (D3 force simulation, SVG rendering)
```

Messages arrive from the broker, flow through the service layer into the Zustand store (which manages the topic tree, EMA rate calculations, and all derived state), and then get rendered as an interactive graph by D3.

A separate Web Worker pipeline handles payload analysis (geo detection, image detection) off the main thread to keep the UI responsive.

## How It Works

### Topic Tree

MQTT topics are `/`-delimited (e.g. `home/kitchen/temp`). Each segment becomes a node in a tree. Parent nodes are created implicitly — even if no message was ever published directly to `home/`, the node exists as an ancestor of `home/kitchen/temp`. The store maintains this tree and updates it incrementally as messages arrive.

### Rate Tracking

Message frequency uses an Exponential Moving Average (EMA) with a configurable time constant (default 5s). A decay timer runs every 500ms, smoothing rates and decaying idle topics toward zero. This produces smooth, readable rate values rather than spiky counters.

### Aggregate Rates

Each node's aggregate rate equals its own message rate plus the sum of all children's aggregate rates, propagated bottom-up after each decay tick. Parent nodes therefore reflect the total activity of their entire subtree — useful for identifying noisy branches at a glance.

### Node Sizing

Node radius follows a logarithmic scale to prevent high-frequency topics from dominating the visual:

```
radius = MIN_R + (MAX_R - MIN_R) * (log(1 + aggregateRate) / log(1 + MAX_RATE))
```

Size changes are smoothly interpolated via an exponential lerp in the 60fps animation loop, preventing jumpy resizing on message bursts or decay ticks.

### D3 + React Integration

The app uses the "D3 in React" pattern: React owns the `<svg>` container element and manages the surrounding UI (panels, tooltips, status bar). D3 takes over inside the SVG via a ref, managing the force simulation and directly manipulating circles, lines, text, and effects. Individual graph elements are not React-rendered — D3 handles them for performance.

The simulation cleanup (stopping forces, removing elements) is handled in a `useEffect` cleanup function to prevent leaks on unmount.

### Payload Analysis

A Web Worker analyses MQTT payloads off the main thread, running detector functions to identify structured data in message payloads:

- **Geo detector** — finds latitude/longitude coordinates via GeoJSON Point geometry or common key-pair patterns (`lat`/`lon`, `latitude`/`longitude`, etc.)
- **Image detector** — identifies JPEG and PNG binary payloads from magic-byte signatures in the UTF-8-decoded string

Detected tags are stored on the topic nodes and can be visualised as indicator rings on the graph or explored in the Insights Drawer (a slide-out Leaflet map for geo data).

## Project Structure

```
public/
  config.json              # Deployment configuration (copied to dist/ on build)
src/
  types/
    index.ts               # TopicNode, GraphNode, GraphLink, ConnectionParams, etc.
    payloadTags.ts          # Payload tag types, detector results, GeoMetadata
    webmcp.d.ts            # Ambient type declarations for W3C WebMCP API
  stores/
    topicStore.ts           # Zustand store: topic tree, EMA rates, decay, settings
  hooks/
    useMqttClient.ts        # MQTT lifecycle hook, localStorage persistence
  services/
    mqttService.ts          # mqtt.js WebSocket wrapper (MQTT v5)
    payloadAnalyzerService.ts # Web Worker lifecycle for off-thread payload analysis
    webMcpService.ts        # WebMCP tool registration (navigator.modelContext)
  workers/
    payloadAnalyzer.worker.ts # Web Worker: runs payload detectors off the main thread
  components/
    ConnectionPanel.tsx     # Broker URL, topic filter, auth, connect/disconnect
    TopicGraph.tsx          # SVG container, syncs store state to GraphRenderer
    GraphRenderer.ts        # D3 force simulation, nodes/links/labels/effects
    DetailPanel.tsx         # Selected node detail panel (stats, payload, properties)
    InsightsDrawer.tsx      # Slide-out Leaflet map with trails and multi-geo mode
    NodeTooltip.tsx         # Hover tooltip for node details
    SettingsPanel.tsx       # Sliders, toggles, collapsible sections
    StatusBar.tsx           # Message/topic counts, uptime
  utils/
    config.ts              # Config loader: fetch and parse config.json
    topicParser.ts          # Topic string parsing, tree operations, ancestor paths
    sizeCalculator.ts       # Logarithmic node radius calculation
    colorScale.ts           # Custom multi-stop colour scale for heat mapping
    formatters.ts           # Rate/timestamp/size formatting, payload truncation
    brokerIcons.ts          # Bundled SVG broker icons + domain matching
    connectionErrors.ts     # Connection error diagnosis and actionable hints
    perfDebug.ts            # Performance debug module (?perf URL param)
    detectors/
      geoDetector.ts        # Geo coordinate detection (key pairs + GeoJSON Point)
      imageDetector.ts      # JPEG/PNG detection from magic-byte signatures
```

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 18 + TypeScript (strict) |
| Build | Vite 5 |
| Styling | Tailwind CSS v3 |
| Visualisation | D3.js v7 (force simulation, SVG) |
| MQTT | mqtt.js v5 (browser WebSocket, MQTT v5 protocol) |
| Maps | Leaflet + OpenStreetMap tiles |
| State | Zustand v5 |
| Deploy | Static SPA — no backend |
