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
- **Default Theme**: Dark. The app is designed for dark backgrounds — glow effects depend on this.

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

Two layered effects on message publish:
1. **Glow/Pulse** — SVG filter (`feGaussianBlur` + `feComposite`) on the node, animated via attribute interpolation. The glow blur scales inversely with zoom level so it appears consistent at any zoom.
2. **Heat map** — Node fill colour mapped from `messageRate` using `d3-scale-chromatic`. Updated on each render tick. Idle nodes display `IDLE_COLOR`/`IDLE_STROKE` (set on enter to avoid the SVG default black fill).
3. **Link pulse** — Links flash `#d1d5db` (grey-300) when both endpoints are pulsing, fading back to the idle colour over `fadeDuration`. Idle link opacity is depth-based (shallow links are fainter) via `linkBaseOpacity()`.

### Link Rendering

Links use depth-based idle opacity to reduce visual clutter near the root:
- Opacity scales linearly from `MIN_LINK_OPACITY` (0.35 at depth 1) to `MAX_LINK_OPACITY` (0.6 at depth 5+).
- Pulse animation overrides to full opacity, then fades back to the depth-based base.
- Pulse flash colour is `#d1d5db` (grey-300), not pure white — avoids blown-out appearance.

### Label Rendering

Labels use a `paint-order: stroke fill` halo for readability: a dark stroke (`#111827`, grey-900) renders behind the light text fill, creating a contrast backdrop without extra DOM elements. The halo opacity scales with the label opacity (zoom/depth/activity mode).

### New Node Placement

When new nodes appear in `GraphRenderer.update()`, they are placed near their parent rather than at the viewport centre. This produces organic tree growth instead of chaotic centre-spawning.

- A `childToParent` map is built from the `links` array (string IDs, before D3 resolves them).
- Nodes are processed in depth-ascending order so parents are always positioned before their children.
- A `justPlaced` map chains positions for burst scenarios where an entire subtree appears in a single frame.
- Root nodes and orphans fall back to viewport centre with jitter.

### Drop Retained Burst

When subscribing (especially with `#`), the broker delivers all stored retained messages as a burst. The `packet.retain` flag is threaded through `mqttService → useMqttClient → topicStore.handleMessage`. During a configurable burst window after connection (default 15 s, range 5–30 s), messages with `retain=true` are **fully dropped** — `handleMessage` returns immediately before `ensureTopicPathTracked`, so no nodes are created, no counters incremented, no visual effects triggered. Non-retained messages always pass normally. After the burst window closes, all messages are processed regardless of retain flag.

- **Settings**: `dropRetainedBurst` (boolean, default `true`) and `burstWindowDuration` (ms, default `15000`). Both persisted to `mqtt_settings` localStorage and included in `resetSettings`.
- **UI**: Connection Panel → Filter tab. Toggle + conditional burst window slider.
- **Prune Idle Nodes** also lives in the Filter tab (moved from Settings → Simulation in v1.13.0).

## Code Quality

- Prefer `const` over `let`. Never use `var`.
- Use named exports, not default exports (except for React components if needed by tooling).
- Keep functions small and focused. Extract helpers into `src/utils/`.
- All utility functions in `src/utils/` should be pure and unit-testable.
- Use descriptive variable names. Avoid abbreviations except for widely understood ones (`msg`, `btn`, `idx`).

## Agent Workflow Rules

- **Never commit or push without user testing first.** Always stop at "ready for you to test" and wait for explicit sign-off before running `git commit` or `git push`. This applies even if the user says "ship it" — if they have not yet confirmed they have tested the current changes, ask them to test first. "Ship it" without a preceding test confirmation is not sign-off.
- **Run `npm run build` and `npm test` before declaring work complete.** Both must pass clean (no type errors, no test failures) before handing off to the user.
- **Bump version on every commit**: patch (x.x.N) for bug fixes and QoL improvements, minor (x.N.0) for new user-facing features.

## Build & Run

```bash
npm install
npm run dev        # Start Vite dev server
npm run build      # Build static SPA to dist/
npm run preview    # Preview production build locally
```

## Testing

Vitest is configured. Run with `npm test`. Tests live in `__tests__/` directories adjacent to their source files.

Current test coverage (292 tests total):
- `src/stores/__tests__/topicStore.test.ts` — 125 tests covering pulse data flow, fade timing, link targeting, ancestor sizing, store state management, node selection, settings reset, highlight sets, batched counter updates, decay rebuild suppression, localStorage settings persistence, selected-node LRU pinning and truncation bypass, payload size tracking, node pruning (stale leaf removal, implicit ancestor cleanup, root/selected protection, sibling preservation, persistence, reset), and drop retained burst (full message drop, no node creation, no counters, non-retained passthrough, persistence, reset).
- `src/utils/__tests__/settingsStorage.test.ts` — 30 tests covering load/persist/clear, corrupt data, missing fields, version mismatch, type and range validation, full round-trip for all 22 persisted fields, `pruneTimeout` validation, `labelStrokeWidth` validation, `dropRetainedBurst` validation, `burstWindowDuration` validation, and `labelMode` values including `"activity"`.
- `src/utils/__tests__/topicParser.test.ts` — 43 tests for topic parsing, tree operations, and ancestor paths.
- `src/utils/__tests__/formatters.test.ts` — 41 tests for rate/timestamp formatting, payload truncation, depth scaling, and payload size formatting.
- `src/utils/__tests__/colorScale.test.ts` — 15 tests for the custom colour scale.
- `src/utils/__tests__/sizeCalculator.test.ts` — 11 tests for logarithmic node radius calculation.
- `src/utils/__tests__/connectionErrors.test.ts` — 27 tests for MQTT connection error diagnosis (mixed content, auth, ECONNREFUSED, DNS, timeout, TLS, wrong endpoint, network unreachable, fallback) and log timestamp formatting.

Utils in `src/utils/` are the highest-priority targets for additional unit tests.

### Broker Icons

SVG icons for known MQTT brokers are bundled in `src/utils/brokerIcons.ts` (sourced from Simple Icons, CC0 public domain). The `getBrokerIcon(url)` function matches a broker URL by domain substring and returns the appropriate icon path + brand colour. Unknown brokers get the generic MQTT protocol icon. The "Custom Broker" option uses `CUSTOM_BROKER_ICON` (a pencil icon, slate-400) — this is handled directly in `ConnectionPanel` rather than via `getBrokerIcon`. Native HTML `<select>` elements cannot render images inside `<option>` tags — the icon is rendered as a separate `<svg>` element beside the dropdown.

### Broker Config and Quick Connect Dropdown

Brokers are defined in `config.json` under the `brokers` key (array of `{ name, url }`). The first entry is used as the default on first load. The dropdown always includes a "Custom Broker" option (sentinel value `__custom__`) as the last entry.

Dropdown/URL field state machine:
- **First-time visitor (no localStorage):** first broker from `cfg.brokers` pre-selected; URL field shows its URL.
- **Returning visitor:** `saved.brokerUrl` from localStorage determines state — if it matches a known broker, that broker is selected; otherwise "Custom Broker" is selected.
- **User edits URL field:** if the typed URL exactly matches a known broker URL, the dropdown syncs to that broker; otherwise it switches to "Custom Broker" and the typed URL is stored as `customBrokerUrl` state.
- **User selects "Custom Broker":** URL field populated with last custom URL they typed/used; empty on first visit.
- **URL param `?broker=`:** highest precedence; shown as "Custom Broker" if not matching a known broker.
- `PublicBroker` type is kept as a deprecated alias for `Broker` for backward compatibility.

### WebMCP Integration

`src/services/webMcpService.ts` registers tools with the browser's `navigator.modelContext` API ([W3C WebMCP spec](https://webmachinelearning.github.io/webmcp/)). This enables browser AI agents to query the topic tree and traffic data.

Key patterns:
- **Feature detection** — `navigator.modelContext` is checked at registration time. If unavailable (not Chrome 146+), the entire module no-ops silently.
- **Config gating** — `webmcpEnabled: false` in `config.json` disables registration.
- **Read from store** — all tool execute functions read from `useTopicStore.getState()`. No new data structures needed.
- **Ambient types** — `src/types/webmcp.d.ts` declares the WebMCP interfaces globally (no `export`). This is an ambient declaration file that augments the `Navigator` interface.
- **Registration lifecycle** — `registerWebMcpTools()` on App mount, `unregisterWebMcpTools()` on unmount.
- **Phase 2 (implemented in v1.7.2)** — interactive tools `highlightNodes` and `clearHighlights` are registered. They write to `highlightedNodes: Map<string, string>` in the store; `TopicGraph` syncs this to `GraphRenderer.setHighlightedNodes()`. A dedicated `highlight-rings` SVG layer (below `nodes`) renders one `<circle>` per highlighted node at `displayRadius + 4` with the caller-specified colour. Cap: 200 nodes. `focusNode` remains future work.

## Common Pitfalls

- **MQTT.js in the browser**: The `mqtt` package must be used with its browser bundle. Vite handles this automatically via the `browser` field in `package.json`, but be aware that Node.js-only features (like `fs`-based certificate loading) are not available.
- **D3 and React fighting over the DOM**: Never let React re-render the SVG graph nodes. React should only own the container. D3 handles everything inside it.
- **WebSocket connection failures**: Browsers enforce CORS and mixed-content rules. An `https://` page cannot connect to `ws://` brokers (mixed content). For self-hosted deployments behind HTTPS (e.g. Tailscale), use an nginx reverse proxy to terminate `wss://` and forward to the broker's `ws://` endpoint. See the `/mqtt_ws/` location block in the pi-infra repo's `boat.horse.conf`.
- **Performance with many topics**: SVG can handle hundreds of nodes but may struggle above ~1000. If performance becomes an issue, the first optimisation is to switch to Canvas rendering (planned as a future enhancement).
- **Wildcard subscriptions**: MQTT wildcards (`#` multi-level, `+` single-level) are handled by the broker, not the client. The client just subscribes with the filter string as-is. The topic tree builder must handle any topic string that arrives.
