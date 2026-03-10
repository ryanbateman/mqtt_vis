# MQTT Topic Visualiser

A real-time, browser-based visualisation of MQTT topic trees. Connect to any broker over WebSocket, subscribe with wildcard support, and watch your topics come alive as an animated force-directed graph.

No backend required — it's a static SPA. Host it anywhere, and the MQTT connection runs directly from the browser.

![MQTT Topic Visualiser screenshot](visualiser.png)

## Features

- **Live topic graph** — topics appear as nodes in a force-directed layout, sized by message rate and coloured by activity
- **Wildcard subscriptions** — subscribe with `#` or `+` and watch the tree grow in real-time
- **Payload analysis** — automatic detection of geo coordinates and image payloads, with map view and image preview
- **Fully configurable** — tune the graph physics, labels, colours, and behaviour via the UI or a `config.json` file
- **WebMCP support** — exposes tools for browser AI agents to query the topic tree (Chrome 146+)

## Quick Start

```bash
npm install
npm run dev
```

Open the URL shown by Vite (typically `http://localhost:5173`), enter a WebSocket broker URL (e.g. `ws://localhost:9001`) and a topic filter, then click Connect.

## Build for Production

```bash
npm run build
```

The output in `dist/` is a fully static SPA — deploy it to any static hosting provider. Edit `dist/config.json` to customise defaults for your deployment without rebuilding.

## Configuration

The app loads `config.json` on startup to set deployment defaults (broker URL, topic filter, UI preferences, simulation parameters). Users can override any setting in the UI; their choices persist in localStorage.

See **[docs/configuration.md](docs/configuration.md)** for the full options reference.

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

## Documentation

- **[Configuration](docs/configuration.md)** — `config.json` options, precedence rules, broker dropdown setup
- **[Hosting & Deployment](docs/hosting.md)** — static hosting, mixed content, reverse proxy setup
- **[Architecture](docs/architecture.md)** — data flow, how it works, project structure
- **[WebMCP Integration](docs/webmcp.md)** — browser AI agent tools
- **[Performance Profiling](docs/performance-profiling.md)** — automated profiling with Playwright

## Acknowledgement

This project was built with [OpenCode](https://opencode.ai) and Claude Opus 4 (`claude-opus-4-6`) by Anthropic.

## License

MIT
