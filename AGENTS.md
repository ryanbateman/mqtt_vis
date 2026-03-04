# AGENTS.md

Guidance and context for AI agents working on this codebase.

## Project Summary

This is a browser-based real-time MQTT topic tree visualiser. It connects to an MQTT broker over WebSocket, subscribes to a topic filter, and renders the topic hierarchy as an animated force-directed graph using D3.js. There is no backend — it is a purely client-side static SPA.

## Tech Stack & Conventions

- **Language**: TypeScript (strict mode). No `any` types unless absolutely unavoidable.
- **Framework**: React 18 with functional components and hooks only. No class components.
- **Build**: Vite. Config lives in `vite.config.ts`.
- **Styling**: Tailwind CSS. Use utility classes in JSX. Avoid custom CSS unless implementing SVG effects or animations that Tailwind cannot express.
- **State Management**: Zustand. A single store in `src/stores/topicStore.ts` holds the topic tree and all derived state. Components subscribe to slices of this store.
- **Visualisation**: D3.js rendering to SVG. D3 manages the force simulation and DOM updates inside a React ref — do not fight React's virtual DOM with D3's DOM manipulation. Use the "D3 in React" pattern: React owns the container `<svg>` element, D3 operates on a ref to it.
- **MQTT Client**: `mqtt` npm package (mqtt.js). The browser build connects via WebSocket (`ws://` or `wss://`). Wrapped in `src/services/mqttService.ts`.
- **Package Manager**: npm.
- **Default Theme**: Dark. The app is designed for dark backgrounds — glow and particle effects depend on this.

## File Organisation

- `src/types/` — TypeScript type/interface definitions. No logic.
- `src/stores/` — Zustand stores. Keep business logic here (rate calculation, tree updates).
- `src/hooks/` — React hooks for MQTT connection and topic tree management.
- `src/services/` — Non-React service wrappers (MQTT client).
- `src/components/` — React components. Keep them presentational where possible; heavy logic goes in stores/hooks.
- `src/utils/` — Pure utility functions (topic parsing, size calculation, colour scales). Must be side-effect-free and unit-testable.

## Key Patterns

### Topic Tree Structure

MQTT topics are `/`-delimited (e.g. `home/kitchen/temp`). Each segment becomes a node in a tree. Parent nodes are created implicitly — even if no message was ever published directly to `home/`, the node exists as an ancestor of `home/kitchen/temp`.

### Rate Tracking

Message frequency uses an Exponential Moving Average (EMA) with a configurable time constant (~5 seconds). A decay timer runs every 500ms. This means:
- Rates are smooth, not spiky.
- Idle topics decay toward zero over several seconds.
- Do not use simple counters or windowed averages.

### Aggregate Rates

Each node's `aggregateRate` = its own `messageRate` + the sum of all children's `aggregateRate`. This is propagated bottom-up after each decay tick. Parent nodes therefore reflect the total activity of their entire subtree.

### Node Sizing

Radius follows a logarithmic scale: `MIN_R + (MAX_R - MIN_R) * (log(1 + aggregateRate) / log(1 + MAX_RATE))`. This prevents high-frequency topics from dominating. Size transitions should be animated smoothly.

### D3 + React Integration

- React renders the `<svg>` container and the `ConnectionPanel`/`StatusBar` UI.
- D3 manages the force simulation and directly manipulates SVG elements inside the container via a React ref.
- Do NOT use React to render individual `<circle>` or `<line>` elements for the graph — let D3 handle this for performance.
- Use `useEffect` with cleanup to start/stop the D3 simulation.

### Visual Effects

Three layered effects on message publish:
1. **Glow/Pulse** — SVG filter (`feGaussianBlur` + `feComposite`) on the node, animated via attribute interpolation.
2. **Particle burst** — Ephemeral `<circle>` elements that expand outward and fade. Remove from DOM after animation completes.
3. **Heat map** — Node fill colour mapped from `messageRate` using `d3-scale-chromatic`. Updated on each render tick.

## Code Quality

- Prefer `const` over `let`. Never use `var`.
- Use named exports, not default exports (except for React components if needed by tooling).
- Keep functions small and focused. Extract helpers into `src/utils/`.
- All utility functions in `src/utils/` should be pure and unit-testable.
- Use descriptive variable names. Avoid abbreviations except for widely understood ones (`msg`, `btn`, `idx`).

## Build & Run

```bash
npm install
npm run dev        # Start Vite dev server
npm run build      # Build static SPA to dist/
npm run preview    # Preview production build locally
```

## Testing

Vitest is configured. Run with `npm test`. Tests live in `__tests__/` directories adjacent to their source files.

Current test coverage (154 tests total):
- `src/stores/__tests__/topicStore.test.ts` — 52 tests covering pulse data flow, fade timing, link targeting, ancestor sizing, store state management, and node selection.
- `src/utils/__tests__/topicParser.test.ts` — 43 tests for topic parsing, tree operations, and ancestor paths.
- `src/utils/__tests__/formatters.test.ts` — 33 tests for rate/timestamp formatting, payload truncation, and depth scaling.
- `src/utils/__tests__/colorScale.test.ts` — 15 tests for the custom colour scale.
- `src/utils/__tests__/sizeCalculator.test.ts` — 11 tests for logarithmic node radius calculation.

Utils in `src/utils/` are the highest-priority targets for additional unit tests.

### Broker Icons

SVG icons for known MQTT brokers are bundled in `src/utils/brokerIcons.ts` (sourced from Simple Icons, CC0 public domain). The `getBrokerIcon(url)` function matches a broker URL by domain substring and returns the appropriate icon path + brand colour. Unknown brokers get the generic MQTT protocol icon. Native HTML `<select>` elements cannot render images inside `<option>` tags — the icon is rendered as a separate `<svg>` element beside the dropdown.

## Common Pitfalls

- **MQTT.js in the browser**: The `mqtt` package must be used with its browser bundle. Vite handles this automatically via the `browser` field in `package.json`, but be aware that Node.js-only features (like `fs`-based certificate loading) are not available.
- **D3 and React fighting over the DOM**: Never let React re-render the SVG graph nodes. React should only own the container. D3 handles everything inside it.
- **WebSocket connection failures**: Browsers enforce CORS and mixed-content rules. An `https://` page cannot connect to `ws://` brokers (mixed content). For self-hosted deployments behind HTTPS (e.g. Tailscale), use an nginx reverse proxy to terminate `wss://` and forward to the broker's `ws://` endpoint. See the `/mqtt_ws/` location block in the pi-infra repo's `boat.horse.conf`.
- **Performance with many topics**: SVG can handle hundreds of nodes but may struggle above ~1000. If performance becomes an issue, the first optimisation is to switch to Canvas rendering (planned as a future enhancement).
- **Wildcard subscriptions**: MQTT wildcards (`#` multi-level, `+` single-level) are handled by the broker, not the client. The client just subscribes with the filter string as-is. The topic tree builder must handle any topic string that arrives.
