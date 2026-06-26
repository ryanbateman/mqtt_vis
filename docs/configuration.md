# Configuration

MQTT Topic Visualiser loads a `config.json` file from the server root on startup. This file lets you set deployment-wide defaults — broker URL, topic filter, UI preferences, simulation parameters — without rebuilding the app. Users can still override any setting through the UI; their choices are saved in `localStorage` and take priority on subsequent visits.

Edit `public/config.json` before building, or `dist/config.json` after building. All fields are optional — omitted fields fall back to hardcoded defaults.

## Security Warning

**The `password` field in `config.json` is stored in plaintext and served as a static file.** Anyone who can access the hosted site can read it by fetching `config.json` directly. Do not include sensitive credentials unless the deployment is on a private network or behind authentication.

## Precedence

When the app resolves a setting, it checks these sources in order:

1. **URL query params** (`?broker=...&topic=...`, plus `?embed` / `?autotour`) — highest priority, one-time override for `brokerUrl`, `topicFilter`, and the display mode (not persisted)
2. **localStorage** — the user's saved preferences from a previous session
3. **config.json** — deployment defaults
4. **Hardcoded defaults** — lowest priority

**Exception:** when `clientId` is set to a non-null string in `config.json`, it is always used regardless of localStorage. This is intended for deployments that require a specific client identity.

## Available Options

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
| `nodeScale` | number | `1.0` | Node radius multiplier (0.5-4.0). Scales all nodes proportionally |
| `scaleNodeSizeByDepth` | boolean | `false` | Scale node display radius inversely with tree depth |
| `ancestorPulse` | boolean | `true` | Pulse parent nodes on descendant messages |
| `showRootPath` | boolean | `false` | Show structural ancestor nodes above subscription prefix |
| `showGeoIndicators` | boolean | `true` | Cyan indicator rings on nodes with detected geo coordinates |
| `showImageIndicators` | boolean | `true` | Purple indicator rings on nodes with detected image payloads |
| `showSparkplugIndicators` | boolean | `true` | Emerald indicator rings on Sparkplug B edge nodes/devices (red dashed when offline) |
| `repulsionStrength` | number | `-350` | Node repulsion force |
| `linkDistance` | number | `155` | Ideal parent-child link distance (px) |
| `linkStrength` | number | `0.5` | Link rigidity (0-1) |
| `collisionPadding` | number | `13` | Extra collision gap around nodes (px) |
| `alphaDecay` | number | `0.01` | Simulation settle speed |
| `settingsCollapsed` | boolean | `false` | Start with settings panel collapsed |
| `connectionCollapsed` | boolean | `false` | Start with connection panel collapsed |
| `webmcpEnabled` | boolean | `true` | Enable WebMCP tool registration for browser AI agents. Set to `false` to disable. |
| `displayMode` | `"normal"` \| `"embed"` \| `"autotour"` | `"normal"` | Chrome-stripping mode (see [Embed & Auto-tour mode](#embed--auto-tour-mode)). `embed` hides all panels; `auto-tour` adds an auto-tour. Overridden by the `?embed` / `?autotour` URL params. |
| `autoTourEntityDwellMs` | number | `8000` | Auto-tour: ms an entity panel (map/image/device) is shown before flipping to the payload tab. |
| `autoTourPayloadDwellMs` | number | `5000` | Auto-tour: ms the payload tab is shown after the entity phase (entity nodes). |
| `autoTourPlainDwellMs` | number | `5000` | Auto-tour: total ms an entity-less node is shown (payload only, shorter). |
| `autoTourIntervalMs` | number | `12000` | Auto-tour: ms gap between picks (graph-only; the view drifts to an overview during this gap). |
| `autoTourRestEvery` | number | `3` | Auto-tour: insert a longer graph-only rest after this many highlights. |
| `autoTourRestMs` | number | `36000` | Auto-tour: length (ms) of the graph-only rest period. |
| `autoTourShakeEvery` | number | `5` | Auto-tour: auto-shake the layout after this many highlights. |
| `description` | string \| null | *(see below)* | Description shown in the connection panel below the title when expanded. Also used as the embed/auto-tour watermark. Set to `""` to hide. Omit or set to `null` to use the built-in default. |

## Example

A config that auto-connects to a private broker on load with both panels collapsed and a wider graph layout:

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

The user can still change settings in the UI — their changes persist in localStorage and take priority on subsequent visits.

## Brokers (Quick Connect)

The `brokers` array populates a "Quick Connect" dropdown in the connection panel. Selecting a broker fills the URL field and shows the broker's brand icon (bundled SVG icons for HiveMQ, Mosquitto, EMQX, and a generic MQTT icon for others). The user still clicks Connect manually.

The default `config.json` ships with three public brokers (HiveMQ, EMQX, Mosquitto). To customise for your deployment:

```json
{
  "brokers": [
    { "name": "Internal Broker", "url": "wss://mqtt.internal.example.com/mqtt" },
    { "name": "HiveMQ", "url": "wss://broker.hivemq.com:8884/mqtt" }
  ]
}
```

To hide the dropdown entirely, set `"brokers": []` or omit the field.

## Auto-tour mode

For embedding the visualiser in dashboards, iframes, digital signage, or a conference-booth display, a stripped-down display mode hides all UI chrome (connection/settings/stats rails, status bar, GitHub link) and shows just the full-screen graph.

- **Auto-tour** (`?autotour` or `"displayMode": "autotour"`) — Full-screen mode with an **auto-tour**: periodically highlights a recently-active node (biasing toward "richer" nodes that belong to an ecosystem or carry a detected entity), shows its entity panel then payload, then returns to the graph. After every `autoTourRestEvery` highlights it rests on the bare graph for `autoTourRestMs`.

This mode auto-hides the cursor after a few idle seconds and shows a subtle watermark (from `description`). User interaction pauses the auto-tour until idle again. **Press `Esc` to return to Normal mode** (or use the Display Mode selector in the Settings panel). The mode set via URL/config is not persisted — reloading restores it.

This mode pairs naturally with `autoconnect: true` and a configured broker so the display comes up live with no interaction:

```json
{
  "brokers": [{ "name": "Wall Display", "url": "wss://mqtt.internal.example.com/mqtt" }],
  "topicFilter": "#",
  "autoconnect": true,
  "displayMode": "autotour",
  "pruneTimeout": 60000
}
```

When `pruneTimeout > 0`, a small caption explains that inactive topics are removed after the timeout, so viewers understand why nodes disappear.
