# WebMCP Integration

[WebMCP](https://webmachinelearning.github.io/webmcp/) is a browser API that lets web applications expose tools to AI agents running in the browser. MQTT Topic Visualiser registers a set of tools with the `navigator.modelContext` API, enabling AI agents to query the topic tree, inspect traffic patterns, and interact with the graph — without any manual copy-paste.

This is useful for asking an AI agent questions like "which topics are noisiest?" or "show me the details for topic X" while the visualiser is running.

## Requirements

- **Chrome 146+** with the WebMCP flag enabled
- `webmcpEnabled` must be `true` in `config.json` (this is the default)

On unsupported browsers, the module silently no-ops — no errors, no console warnings, no feature degradation.

## Available Tools

### Query tools

These tools are read-only and let an AI agent explore the topic tree and traffic data:

| Tool | Description |
|---|---|
| `getTopicTree` | Get the topic tree structure (capped at `maxDepth`, default 5) |
| `getActiveTopics` | List topics currently receiving messages, sorted by direct rate |
| `getNoisyTopics` | List highest-traffic subtrees, ranked by aggregate rate |
| `findTopics` | Search topics by substring pattern with optional rate/depth filters |
| `getTopicDetails` | Get full details for a specific topic (rate, payload, QoS, payload sizes, etc.) |
| `getLargestPayloads` | List topics ranked by all-time largest payload size; supports `limit` and `minSize` filters |
| `getStats` | Session statistics: total messages, topics, uptime, top 10 active |

All query tools are marked `readOnlyHint: true`.

### Interactive tools

These tools modify the visual state of the graph:

| Tool | Description |
|---|---|
| `exportGraph` | Trigger a PNG export of the current graph view |
| `highlightNodes` | Highlight up to 200 nodes with coloured rings; replaces any existing highlights |
| `clearHighlights` | Remove all highlight rings |

## Disabling WebMCP

To disable tool registration entirely, set `webmcpEnabled` to `false` in `config.json`:

```json
{
  "webmcpEnabled": false
}
```
