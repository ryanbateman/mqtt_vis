# Configuration

MQTT Topic Visualiser loads a `config.json` file from the server root on startup. This file lets you set deployment-wide defaults — broker URL, topic filter, UI preferences, simulation parameters — without rebuilding the app. Users can still override any setting through the UI; their choices are saved in `localStorage` and take priority on subsequent visits.

Edit `public/config.json` before building, or `dist/config.json` after building. All fields are optional — omitted fields fall back to hardcoded defaults.

## Security Warning

**The `password` field in `config.json` is stored in plaintext and served as a static file.** Anyone who can access the hosted site can read it by fetching `config.json` directly. Do not include sensitive credentials unless the deployment is on a private network or behind authentication.

## Precedence

When the app resolves a setting, it checks these sources in order:

1. **URL query params** (`?broker=...&topic=...`) — highest priority, one-time override for `brokerUrl` and `topicFilter` only (not persisted)
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
| `repulsionStrength` | number | `-350` | Node repulsion force |
| `linkDistance` | number | `155` | Ideal parent-child link distance (px) |
| `linkStrength` | number | `0.5` | Link rigidity (0-1) |
| `collisionPadding` | number | `13` | Extra collision gap around nodes (px) |
| `alphaDecay` | number | `0.01` | Simulation settle speed |
| `settingsCollapsed` | boolean | `false` | Start with settings panel collapsed |
| `connectionCollapsed` | boolean | `false` | Start with connection panel collapsed |
| `webmcpEnabled` | boolean | `true` | Enable WebMCP tool registration for browser AI agents. Set to `false` to disable. |
| `description` | string \| null | *(see below)* | Description shown in the connection panel below the title when expanded. Set to `""` to hide. Omit or set to `null` to use the built-in default. |

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
