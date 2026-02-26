# MQTT Topic Visualiser

A browser-based, real-time visualisation of an MQTT topic tree. Connect to any MQTT broker over WebSocket, subscribe to a topic filter (with wildcard support), and watch the topic tree come alive as a force-directed graph. Inspired by GitMotion — nodes glow, pulse, emit particles, and shift colour based on publish activity.

## Overview

The user enters a WebSocket broker URL and a topic filter (e.g. `home/#`, `sensors/+/temp`). The app subscribes and renders every discovered topic as a node in a D3.js force-directed graph. Parent nodes are created implicitly from topic segments (e.g. `home/kitchen/temp` produces nodes for `home`, `kitchen`, and `temp`). Nodes grow and shrink based on message frequency, with visual effects firing on each publish.

## Tech Stack

| Layer          | Choice                                  |
| -------------- | --------------------------------------- |
| Framework      | React 18 + TypeScript                   |
| Build          | Vite                                    |
| Styling        | Tailwind CSS                            |
| Visualisation  | D3.js (force-directed graph, SVG)       |
| MQTT           | mqtt.js (browser bundle, WebSocket)     |
| State          | Zustand                                 |
| Deploy         | Static SPA (host anywhere)              |
| Default Theme  | Dark                                    |

## Architecture

```
+---------------------------------------------------+
|  Browser SPA                                      |
|                                                   |
|  +------------+   +----------------+   +--------+ |
|  | Connection |-->| Topic Store    |-->| D3     | |
|  | Panel      |   | (Zustand)      |   | Graph  | |
|  +------------+   +----------------+   +--------+ |
|       |                 ^                   |      |
|       v                 |                   v      |
|  +------------+   +----------------+   +--------+ |
|  | MQTT.js    |-->| Topic Tree     |   | SVG    | |
|  | Client     |   | Builder        |   | Canvas | |
|  +------------+   +----------------+   +--------+ |
+---------------------------------------------------+
        |
        v  (WebSocket)
   MQTT Broker
```

The browser connects directly to the MQTT broker over WebSocket — no backend server is required.

## Project Structure

```
mqtt_topic_visualiser_2/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── public/
│   └── favicon.svg
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css                  # Tailwind base styles
    ├── types/
    │   └── index.ts               # TopicNode, GraphNode, GraphLink, etc.
    ├── stores/
    │   └── topicStore.ts          # Zustand store for topic tree + stats
    ├── hooks/
    │   ├── useMqttClient.ts       # Connect/disconnect/subscribe logic
    │   └── useTopicTree.ts        # Build & maintain tree from flat topics
    ├── services/
    │   └── mqttService.ts         # MQTT.js wrapper
    ├── components/
    │   ├── ConnectionPanel.tsx     # URL + topic input, connect button
    │   ├── TopicGraph.tsx          # D3 force-directed graph container
    │   ├── GraphRenderer.ts       # D3 simulation, node/link rendering
    │   ├── NodeEffects.ts         # Glow, pulse, particle, heatmap logic
    │   └── StatusBar.tsx          # Connection status, message count
    └── utils/
        ├── topicParser.ts         # Split topic strings, build tree
        ├── sizeCalculator.ts      # Log-scale node sizing from rate
        └── colorScale.ts          # Frequency-to-colour mapping
```

## Key Dependencies

- `react` + `react-dom` (^18)
- `vite` + `@vitejs/plugin-react`
- `typescript`
- `mqtt` (browser build via mqtt.js)
- `d3` (force, selection, scale, zoom, scale-chromatic)
- `zustand`
- `tailwindcss` + `postcss` + `autoprefixer`

## Data Model

### Topic Tree

Each MQTT topic string (e.g. `home/kitchen/temp`) is split by `/` into segments. Each segment becomes a node in a tree structure. Intermediate/parent nodes are created implicitly.

```
TopicNode {
  id: string               // full topic path, e.g. "home/kitchen/temp"
  segment: string           // this node's segment, e.g. "temp"
  children: Map<string, TopicNode>
  messageCount: number      // total messages received directly
  messageRate: number       // EMA-based msgs/sec (direct)
  aggregateRate: number     // own rate + sum of all descendant rates
  lastPayload: string | null
  lastTimestamp: number
  lastQoS: 0 | 1 | 2
}
```

### Rate Calculation (Exponential Moving Average)

```
alpha = 1 - e^(-deltaTime / tau)       // tau = time constant (e.g. 5 seconds)
rate  = alpha * instantRate + (1 - alpha) * prevRate
```

A decay timer runs every 500ms, applying the EMA formula to each node. When no messages arrive, the rate decays smoothly toward zero, causing nodes to shrink.

### Aggregate Rate Propagation

```
node.aggregateRate = node.messageRate + sum(child.aggregateRate for child in children)
```

Propagated bottom-up after each decay tick. Parent nodes grow based on the total activity of their entire subtree.

### Logarithmic Node Sizing

```
radius = MIN_R + (MAX_R - MIN_R) * (log(1 + aggregateRate) / log(1 + MAX_RATE))
```

- `MIN_R`: minimum node radius (e.g. 8px)
- `MAX_R`: maximum node radius (e.g. 60px)
- `MAX_RATE`: the rate at which a node reaches max size (tunable)

Nodes grow logarithmically with message frequency and shrink back when idle. The logarithmic scale prevents a single high-frequency topic from dominating the visualisation.

## Visual Effects

All effects are rendered in SVG and designed for a dark background.

### 1. Glow / Pulse

On message arrival, the node briefly glows — a bright stroke and drop-shadow SVG filter that fades over ~500ms.

### 2. Ripple / Particle Burst

Ephemeral SVG circles burst outward from the node on publish and fade out. Creates a visual "ping" effect.

### 3. Heat Map Colouring

Node fill colour is mapped from the `messageRate` to a colour scale (e.g. `d3-scale-chromatic` `interpolateInferno` — cool blue/purple for low activity, hot orange/red for high activity). Updated continuously as rates change.

## D3 Force-Directed Graph

The topic tree is flattened into `nodes[]` and `links[]` arrays for D3:

- **`forceLink`** — connects parent to child nodes
- **`forceManyBody`** — repulsion between all nodes
- **`forceCenter`** — keeps the graph centered in the viewport
- **`forceCollide`** — prevents overlap, using each node's dynamic radius

The simulation runs continuously. Zoom and pan are handled by `d3-zoom`.

## Connection Panel

- **Broker URL** — `ws://` or `wss://` WebSocket endpoint
- **Topic filter** — supports MQTT wildcards (`#` for multi-level, `+` for single-level)
- **Username / Password** — optional, collapsible
- **Connect / Disconnect** button with status indicator
- Last connection settings are persisted in `localStorage`

## Status Bar

- Connection status (connected / disconnected / reconnecting)
- Total messages received
- Total topics discovered
- Session uptime

## Implementation Phases

| Phase | Description                                                          | Size   |
| ----- | -------------------------------------------------------------------- | ------ |
| 1     | Project scaffold — Vite + React + TS + Tailwind, base layout        | Small  |
| 2     | MQTT connection — Connection panel UI, mqtt.js integration           | Medium |
| 3     | Topic tree data model — Zustand store, parser, tree, rate tracking   | Medium |
| 4     | Basic graph rendering — D3 force graph, nodes + links, zoom/pan      | Large  |
| 5     | Dynamic sizing — log-scale sizing from aggregate rate, decay, shrink | Medium |
| 6     | Visual effects — glow, pulse, particles, heat-map colouring          | Large  |
| 7     | Polish — status bar, localStorage, dark theme, responsive layout     | Medium |

## Future Enhancements (not in v1)

- Message payload inspector panel (click a node to see last payload, timestamp, QoS)
- Topic statistics sidebar (message rate, total count, avg payload size per topic)
- Filtering / search / highlight specific topics
- Canvas rendering for large-scale topic trees (1000+ nodes)
- Alternative layouts (radial tree, hierarchical)
- Export / snapshot (save tree view as image or JSON)
- Light theme / system-preference theme toggle
