# MQTT Topic Visualiser

A browser-based, real-time visualisation of MQTT topic trees. Connect to any MQTT broker over WebSocket, subscribe with wildcard support, and watch topics come alive as an animated force-directed graph. Nodes glow, pulse, emit particles, and shift colour based on publish activity.

**No backend required** — the entire application is a static SPA. The MQTT connection runs directly from the user's browser to the broker via WebSocket. You host static files and that's it.

![MQTT Topic Visualiser screenshot](visualiser.png)

## Features

- **Force-directed graph** — topics rendered as an interactive D3.js SVG graph with zoom, pan, and drag
- **Live message tracking** — nodes grow and shrink based on message frequency using exponential moving average (EMA) rate calculation
- **Visual effects** — three layered effects on message publish: glow/pulse (SVG filter), particle burst, and heat-map colouring
- **Custom colour scale** — nodes shift from slate through sky blue, orange, amber, to yellow as activity increases
- **Ancestor pulse** — optional: when a message arrives, all parent nodes up to the root pulse (toggleable)
- **Root path filtering** — hide structural ancestor nodes above the subscription prefix (e.g. subscribing to `sensors/temp/#` with this off shows only `temp` and its children)
- **Zoom-aware labels** — labels stay constant screen size and fade smoothly across 4 depth levels when zoomed out
- **Settings panel** — 7 sliders for visual and simulation parameters (fade time, label depth, repulsion, link distance, link strength, collision gap, settle speed) with collapsible sections and hover tooltips
- **MQTT client ID** — randomised by default (`mqtt_visualiser_<hex>`), with a toggle to manually define a custom ID
- **Connection persistence** — broker URL, topic filter, username, and client ID are saved to localStorage
- **Clear on disconnect** — optional checkbox to reset the graph when disconnecting
- **Dark theme** — designed for dark backgrounds with glow and particle effects
- **Wildcard subscriptions** — supports MQTT `#` (multi-level) and `+` (single-level) wildcards

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

The output in `dist/` is a fully static SPA — deploy it to any static hosting (GitHub Pages, Netlify, S3, etc.).

## Usage

### Connection Panel (top-left)

| Field | Description |
|---|---|
| **Broker URL** | WebSocket endpoint (`ws://` or `wss://`) |
| **Topic Filter** | MQTT subscription filter. `#` for all topics, `+` for single-level wildcard |
| **Client ID** | Randomised by default. Toggle "Custom" to define your own (disabled while connected) |
| **Authentication** | Optional username/password (click "Show authentication") |

### Settings Panel (top-right)

**Appearance**
- **Fade Time** — how long messages affect node size and colour (EMA time constant)
- **Label Depth** — how many levels of labels stay visible when zoomed out
- **Ancestor Pulse** — toggle whether parent nodes pulse when descendants receive messages
- **Show Root Path** — toggle visibility of structural ancestor nodes above the subscription prefix

**Simulation**
- **Repulsion** — how strongly nodes push each other apart
- **Link Distance** — ideal spacing between connected parent-child nodes
- **Link Strength** — how rigidly links enforce their ideal distance
- **Collision Gap** — extra space around nodes to prevent overlap
- **Settle Speed** — how quickly the graph stops moving after changes

### Status Bar (bottom)

Shows total messages received, unique topics discovered, and session uptime.

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 18 + TypeScript (strict) |
| Build | Vite 5 |
| Styling | Tailwind CSS v3 |
| Visualisation | D3.js v7 (force simulation, SVG) |
| MQTT | mqtt.js v5 (browser WebSocket bundle) |
| State | Zustand v5 |
| Deploy | Static SPA |

## Project Structure

```
src/
  types/
    index.ts               # TopicNode, GraphNode, GraphLink, ConnectionParams, Particle
  stores/
    topicStore.ts           # Zustand store: topic tree, EMA rates, decay, settings
  hooks/
    useMqttClient.ts        # MQTT lifecycle hook, localStorage persistence
  services/
    mqttService.ts          # mqtt.js WebSocket wrapper
  components/
    ConnectionPanel.tsx     # Broker URL, topic filter, client ID, auth, connect/disconnect
    TopicGraph.tsx          # SVG container, syncs store state to GraphRenderer
    GraphRenderer.ts        # D3 force simulation, nodes/links/labels/effects/particles
    SettingsPanel.tsx       # Sliders, toggles, collapsible sections, portal tooltips
    StatusBar.tsx           # Message/topic counts, uptime
  utils/
    topicParser.ts          # Topic string parsing, tree operations, ancestor paths
    sizeCalculator.ts       # Logarithmic node radius from aggregate rate
    colorScale.ts           # Custom multi-stop colour scale (slate > sky > orange > amber > yellow)
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

### D3 + React Integration

React owns the `<svg>` container element. D3 manages the force simulation and directly manipulates SVG elements inside it via a ref. Individual graph elements (circles, lines, text) are not React-rendered — D3 handles them for performance.

## Hosting Notes

This is a purely client-side application. The hosted files are static HTML, CSS, and JS. All MQTT connections happen directly between the user's browser and whatever broker they configure.

**Mixed content**: GitHub Pages (and most static hosts) serve over HTTPS. Browsers block mixed content, so users will only be able to connect to `wss://` brokers, not plain `ws://`. This is a browser security restriction, not an application limitation.

## Acknowledgement

This project was built with [OpenCode](https://opencode.ai) and Claude Opus 4 (`claude-opus-4-6`) by Anthropic.

## License

MIT
