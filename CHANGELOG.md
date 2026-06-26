# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.33.0] - 2026-06-26

### Added
- Auto-tour display mode for dashboards and digital signage (`?autotour` or `displayMode: "autotour"`)
- 7 configurable auto-tour timing parameters (dwell times, intervals, rest periods)
- Auto-tour overlay with connection status watermark
- Idle detection for auto-pause during user interaction
- Auto-tour button in Connection panel (appears when connected)

### Changed
- Reorganized Connection panel with tabbed interface (Connect/Log/Share)
- Moved "Clear graph on disconnect" to Settings → Visual
- Optimized graph renderer performance (dynamic pulse rings, O(1) node access, throttled updates)
- Auto-tour prefers "rich" nodes (with entities/ecosystems) with 3x weight bias

### Removed
- Embed display mode (parked for future consideration)

### Performance
- Dynamic pulse ring rendering using D3 data-join
- Self-pausing rAF loop to reduce unnecessary redraws
- Cached element references and O(1) node access via nodeById map
- Throttled hit-area sync, skip layout shake on large graphs (>1000 nodes)

## [1.32.1] - 2026-06-20

### Added
- Per-ecosystem count blocks in center status bar

## [1.32.0] - 2026-06-18

### Added
- Tasmota ecosystem support

### Changed
- Skip Delock ecosystem (no MQTT presence)

## [1.31.1] - 2026-06-15

### Changed
- Refreshed README features: new ecosystems, Stats dashboard, node colouring
