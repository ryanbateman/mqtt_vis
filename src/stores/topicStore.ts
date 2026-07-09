import { create } from "zustand";
import type {
  TopicNode,
  ConnectionStatus,
  GraphNode,
  GraphLink,
  LabelMode,
  DisplayMode,
  MqttUserProperties,
} from "../types";
import type { DetectorResult, EntityTagMetadata } from "../types/payloadTags";
import type { SparkplugDeviceState, SparkplugMetadata, SparkplugTopicInfo } from "../types/sparkplug";
import type { DomainEntity, EntityDeclaration } from "../types/entities";
import type { IndicatorSettingsKey } from "../utils/tagRegistry";
import {
  createEntityRegistry,
  clearEntityRegistry,
  applyEntityDeclarations,
  applyConfigTombstone,
  collectDeclaredTopics,
  recordEntityTopicHit,
  removeEntityNodeRef,
  isEcosystemDefiningTopic,
} from "../utils/ecosystems/entityOps";
import { mqttTopicMatches } from "../utils/mqttMatch";
import { mqttService } from "../services/mqttService";
import { isHaDiscoveryTopic, parseHaDiscovery } from "../utils/ecosystems/homeassistant/discovery";
import { recordFrigateMessage } from "../utils/ecosystems/frigate";
import { recordShellyMessage, isShellyAnnounceTopic, parseShellyAnnounce } from "../utils/ecosystems/shelly";
import { recordOwnTracksMessage } from "../utils/ecosystems/owntracks";
import { recordLorawanMessage } from "../utils/ecosystems/lorawan";
import { recordHomieMessage, createHomieState, isHomieAttributeTopic } from "../utils/ecosystems/homie";
import { recordOpenDtuMessage } from "../utils/ecosystems/opendtu";
import { recordTasmotaMessage } from "../utils/ecosystems/tasmota";
import {
  isSparkplugTopic,
  parseSparkplugTopic,
  sparkplugDeviceKey,
  isBirth,
  isDeath,
} from "../utils/sparkplug/topic";
import {
  applySparkplugLifecycle,
  applySparkplugMetrics,
  applySparkplugSeq,
  appendMetricHistory,
  cascadeEdgeDeath,
  type MetricSample,
} from "../utils/sparkplug/lifecycle";
import { payloadAnalyzer } from "../services/payloadAnalyzerService";
import {
  createTopicNode,
  ensureTopicPathTracked,
  flattenTree,
  collectAllNodes,
  getAncestorPaths,
  getFixedPrefix,
  findNode,
} from "../utils/topicParser";
import { calculateRadius } from "../utils/sizeCalculator";
import { getConfig, type AppConfig } from "../utils/config";
import { perfMark, perfMeasure, perfStats } from "../utils/perfDebug";
import {
  loadSavedSettings,
  persistSettings,
  clearSavedSettings,
} from "../utils/settingsStorage";

/** Default EMA time constant in seconds. Controls how quickly rates respond. */
const DEFAULT_EMA_TAU = 5;

/**
 * Resolve the initial display mode. Precedence: URL param (?autotour) >
 * config.displayMode > "normal".
 */
function resolveInitialDisplayMode(cfg: AppConfig): DisplayMode {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("autotour")) return "autotour";
  } catch {
    // window.location unavailable — fall through to config
  }
  if (cfg.displayMode === "autotour") return "autotour";
  return "normal";
}

/** Decay interval in milliseconds. */
const DECAY_INTERVAL = 500;

/**
 * Pulse duration equals emaTau in milliseconds.
 * This means "Fade Time = 5s" produces a 5-second fade window.
 */

interface TopicStoreState {
  /** Root of the topic tree. */
  root: TopicNode;
  /** Flattened graph nodes for D3. */
  graphNodes: GraphNode[];
  /** Links between parent/child for D3. */
  graphLinks: GraphLink[];
  /** MQTT connection status. */
  connectionStatus: ConnectionStatus;
  /** Total messages received this session. */
  totalMessages: number;
  /** Total unique topics discovered (excluding root). */
  totalTopics: number;
  /** Session start time. */
  sessionStart: number;
  /** Error message if connection failed. */
  errorMessage: string | null;
  /** EMA time constant in seconds. Controls how long messages affect node appearance. */
  emaTau: number;
  /** Whether labels are visible at all. */
  showLabels: boolean;
  /** Controls how many tree depths of labels are visible at a given zoom level. */
  labelDepthFactor: number;
  /** How label visibility is determined: 'zoom' (fade by zoom level) or 'depth' (hard cutoff by tree depth). */
  labelMode: LabelMode;
  /** Base font size for labels in pixels. Used as maximum when depth scaling is on. */
  labelFontSize: number;
  /** Stroke width for the label text halo outline (4.5–13.5). */
  labelStrokeWidth: number;
  /** Whether to scale label text size inversely with tree depth. */
  scaleTextByDepth: boolean;
  /** Whether to show tooltips on node hover. */
  showTooltips: boolean;
  /** Whether to clear the graph when disconnecting from the broker. */
  clearOnDisconnect: boolean;
  /** Multiplier for node radius (0.5–4.0). Scales both min and max radius proportionally. */
  nodeScale: number;
  /** Whether to scale node display radius inversely with tree depth. */
  scaleNodeSizeByDepth: boolean;

  // --- Simulation parameters ---
  /** Repulsion strength between nodes (negative = repel). */
  repulsionStrength: number;
  /** Ideal distance between linked parent-child nodes. */
  linkDistance: number;
  /** True while a layout "shake" is cycling the force params (transient UI flag). */
  isShaking: boolean;
  /** How rigidly links enforce their ideal distance (0..1). */
  linkStrength: number;
  /** Extra pixels added to node radius for collision detection. */
  collisionPadding: number;
  /** How quickly the simulation settles after changes. */
  alphaDecay: number;
  /** Inactivity timeout (ms) after which stale nodes are pruned. 0 = disabled. */
  pruneTimeout: number;
  /** Whether to fully drop retained messages during the post-subscribe burst window. */
  dropRetainedBurst: boolean;
  /** Duration (ms) of the burst window after connection during which retained messages are dropped. */
  burstWindowDuration: number;
  /** Whether to show geo-tagged node indicator rings in the graph. */
  showGeoIndicators: boolean;
  /** Whether to show image-tagged node indicator rings in the graph. */
  showImageIndicators: boolean;
  /** Whether to show sparkplug edge-node/device indicator rings in the graph. */
  showSparkplugIndicators: boolean;
  /** Whether to show Home Assistant entity indicator rings in the graph. */
  showHomeAssistantIndicators: boolean;
  /** Whether to show Frigate camera indicator rings in the graph. */
  showFrigateIndicators: boolean;
  /** Whether to show Shelly device indicator rings in the graph. */
  showShellyIndicators: boolean;
  /** Whether to show OwnTracks tracker indicator rings in the graph. */
  showOwnTracksIndicators: boolean;
  /** Whether to show The Things Network (LoRaWAN) indicator rings in the graph. */
  showTtnIndicators: boolean;
  /** Whether to show ChirpStack (LoRaWAN) indicator rings in the graph. */
  showChirpstackIndicators: boolean;
  /** Whether to show Homie device/node indicator rings in the graph. */
  showHomieIndicators: boolean;
  /** Whether to show OpenDTU gateway/inverter indicator rings in the graph. */
  showOpenDtuIndicators: boolean;
  /** Whether to show Tasmota device indicator rings in the graph. */
  showTasmotaIndicators: boolean;
  /** Whether insight/ecosystem rings fade with node activity, like the bodies. */
  fadeIndicatorRings: boolean;
  /**
   * Whether to auto-subscribe to ecosystem-declared state/availability
   * topics that fall outside the primary filter (e.g. HA discovery configs
   * pointing at zigbee2mqtt/...). Makes entities live instead of static.
   */
  followEcosystemTopics: boolean;
  /** Toggle follow-on ecosystem subscriptions. */
  setFollowEcosystemTopics: (enabled: boolean) => void;
  /** Whether ancestor nodes pulse when a descendant receives a message. */
  ancestorPulse: boolean;
  /** Whether to show the structural root-path nodes above the subscription prefix. */
  showRootPath: boolean;
  /** The current MQTT subscription topic filter. */
  topicFilter: string;
  /**
   * Incremented whenever the graph structure changes (nodes added/removed).
   * Rate-only changes (pulse, decay) do NOT increment this.
   * TopicGraph uses this to decide whether to call renderer.update() (D3 data join)
   * or just let the animation loop handle visual updates.
   */
  graphStructureVersion: number;
  /** Incremented when an export is requested. TopicGraph watches this to trigger renderer.exportPng(). */
  exportRequested: number;
  /**
   * Live Sparkplug B edge-node/device state, keyed by deviceKey
   * ("group/edge" or "group/edge/device"). Mutated in place;
   * sparkplugVersion is bumped on every change for React reactivity.
   */
  sparkplugDevices: Map<string, SparkplugDeviceState>;
  /** Incremented whenever sparkplugDevices content changes. */
  sparkplugVersion: number;
  /**
   * Discovery-based domain entities (Home Assistant today), keyed by
   * "<ecosystem>:<id>". Mutated in place via the entity registry
   * (entityOps.ts); entitiesVersion is bumped (batched) on change.
   */
  domainEntities: Map<string, DomainEntity>;
  /** Incremented whenever domainEntities content changes. */
  entitiesVersion: number;
  /**
   * True while the topic tree is at TOPIC_NODE_CAP — new topics are being
   * dropped. Recomputed on each batched flush; clears when pruning frees space.
   */
  nodeCapReached: boolean;
  /** ID of the currently selected/pinned node, or null if nothing is selected. */
  selectedNodeId: string | null;
  /** Display mode: "normal" | "autotour". Session-only (not persisted) — durable
   *  activation is via URL param (?autotour) or config.json. */
  displayMode: DisplayMode;
  /** Node the graph view should pan to centre (set by the auto-tour). */
  centerNodeId: string | null;
  /** Bumped on each centre request so repeats on the same id still fire. */
  centerNodeNonce: number;
  /** Bumped to request a slow zoom-out-to-overview (auto-tour graph-only phases). */
  fitViewNonce: number;
  /** Duration (ms) for the requested overview drift. */
  fitViewDuration: number;
  /**
   * Map of nodeId → CSS colour hex for externally highlighted nodes.
   * Populated by WebMCP tools or other internal consumers.
   * Capped at MAX_HIGHLIGHTED_NODES entries (silently truncated).
   */
  highlightedNodes: Map<string, string>;
  /** Whether the burst drop window is currently active (dropping retained messages). UI-only — drives the header indicator. */
  burstWindowActive: boolean;
  /** Whether burst settings (checkbox + slider) are locked. True from connect (when dropRetainedBurst is on) until disconnect. */
  burstSettingsLocked: boolean;

  /** Toggle ancestor pulse behaviour. */
  setAncestorPulse: (enabled: boolean) => void;
  /** Toggle root path node visibility. */
  setShowRootPath: (enabled: boolean) => void;
  /** Store the current topic filter (called on connect). */
  setTopicFilter: (filter: string) => void;

  /** Process an incoming MQTT message. retain defaults to false for backward compatibility. */
  handleMessage: (topic: string, payload: string, qos: 0 | 1 | 2, retain?: boolean, userProperties?: MqttUserProperties, imageBlobUrl?: string, rawPayload?: ArrayBuffer) => void;
  /**
   * True when a retained message arriving NOW would be dropped by the burst
   * window. Lets the MQTT message handler skip per-message work (blob
   * creation, byte copies, UTF-8 decode) for messages the store would
   * immediately discard.
   */
  wouldDropRetained: () => boolean;
  /** Begin recording metric history for one device (panel opened). Clears prior history. */
  startSparkplugHistory: (deviceKey: string) => void;
  /** Stop recording metric history and discard samples (panel closed). */
  stopSparkplugHistory: () => void;
  /** Samples for one metric of the currently watched device (oldest first). */
  getSparkplugHistory: (metricName: string) => readonly MetricSample[] | undefined;
  /** Update connection status. */
  setConnectionStatus: (status: ConnectionStatus, error?: string) => void;
  /** Run one decay tick — called periodically. */
  decayTick: () => void;
  /** Rebuild the flat graph data from the tree. */
  rebuildGraph: () => void;
  /**
   * Schedule a graph rebuild on the next animation frame.
   * Multiple calls within the same frame are coalesced into one rebuild.
   */
  scheduleRebuild: (structural: boolean) => void;
  /** Reset the store (on disconnect). */
  reset: () => void;
  /** Reset all visual, label, and simulation settings to config.json defaults. */
  resetSettings: () => void;
  /** Update the EMA time constant. */
  setEmaTau: (tau: number) => void;
  /** Toggle label visibility. */
  setShowLabels: (show: boolean) => void;
  /** Update the label depth factor. */
  setLabelDepthFactor: (factor: number) => void;
  /** Update the label visibility mode. */
  setLabelMode: (mode: LabelMode) => void;
  /** Update the base label font size. */
  setLabelFontSize: (size: number) => void;
  /** Update the label text halo stroke width. */
  setLabelStrokeWidth: (width: number) => void;
  /** Toggle depth-based text scaling. */
  setScaleTextByDepth: (enabled: boolean) => void;
  /** Toggle hover tooltips on nodes. */
  setShowTooltips: (show: boolean) => void;
  /** Toggle clearing the graph on disconnect. */
  setClearOnDisconnect: (clear: boolean) => void;
  /** Update the node radius scale multiplier. */
  setNodeScale: (scale: number) => void;
  /** Toggle depth-based node size scaling. */
  setScaleNodeSizeByDepth: (enabled: boolean) => void;
  /** Toggle fading insight/ecosystem rings with node activity. */
  setFadeIndicatorRings: (enabled: boolean) => void;
  /** Update simulation parameters. */
  setRepulsionStrength: (value: number) => void;
  setLinkDistance: (value: number) => void;
  /**
   * Animate the force layout into a better spread: crank repulsion and link
   * distance to their extremes (full -> min -> full -> min) and settle at the
   * midpoint of each range, reheating the simulation at every step. Mirrors
   * manually slamming both sliders to shake a tangled graph loose.
   */
  shakeLayout: () => void;
  setLinkStrength: (value: number) => void;
  setCollisionPadding: (value: number) => void;
  setAlphaDecay: (value: number) => void;
  /** Update the prune timeout (ms). 0 = disabled. */
  setPruneTimeout: (value: number) => void;
  /** Toggle dropping retained messages during burst window. */
  setDropRetainedBurst: (enabled: boolean) => void;
  /** Update the burst window duration (ms). */
  setBurstWindowDuration: (value: number) => void;
  /** Toggle a payload tag's indicator rings in the graph (see tagRegistry). */
  setIndicatorEnabled: (key: IndicatorSettingsKey, enabled: boolean) => void;
  /** Request a PNG export of the current graph. */
  requestExport: () => void;
  /** Set the currently selected/pinned node (or null to deselect). */
  setSelectedNodeId: (id: string | null) => void;
  /** Switch the chrome-stripping display mode (e.g. Esc to exit, or the Settings button). */
  setDisplayMode: (mode: DisplayMode) => void;
  /** Request the graph view pan to centre the given node (auto-tour). */
  requestCenterOnNode: (id: string) => void;
  /** Request a slow zoom-out to an overview over `durationMs` (auto-tour graph-only phases). */
  requestFitView: (durationMs: number) => void;
  /**
   * Replace the full highlighted-node set. Entries beyond MAX_HIGHLIGHTED_NODES
   * are silently dropped. Pass an empty Map (or call clearHighlights) to remove all highlights.
   */
  setHighlightedNodes: (nodes: Map<string, string>) => void;
  /** Remove all node highlights. */
  clearHighlights: () => void;
  /** Store payload analysis tags on a topic node (called by the analyzer worker callback). */
  setPayloadTags: (nodeId: string, tags: DetectorResult[]) => void;
}

/**
 * Determine the visual root node for graph rendering.
 * When showRootPath is false, we skip the structural ancestors above the
 * subscription prefix — e.g. for "test/robot/huge/#", we start the graph
 * at the "huge" node (the last fixed segment before the first wildcard).
 */
function getVisualRoot(
  root: TopicNode,
  showRootPath: boolean,
  topicFilter: string
): TopicNode {
  if (showRootPath) return root;

  const prefix = getFixedPrefix(topicFilter);
  if (prefix.length === 0) return root; // e.g. "#" — nothing to skip

  // Walk to the parent of the last fixed segment
  const parentPath = prefix.slice(0, -1);
  const parentNode = findNode(root, parentPath);
  if (!parentNode) return root; // prefix doesn't exist in tree yet — fall back

  // The visual root is the last fixed segment's node
  const lastSegment = prefix[prefix.length - 1];
  const visualRoot = parentNode.children.get(lastSegment);
  if (!visualRoot) return root; // hasn't been created yet

  return visualRoot;
}

function buildGraphData(
  root: TopicNode,
  pulseDuration: number,
  showRootPath: boolean,
  topicFilter: string,
  ancestorPulse: boolean,
  nodeScale: number
): {
  graphNodes: GraphNode[];
  graphLinks: GraphLink[];
} {
  const visualRoot = getVisualRoot(root, showRootPath, topicFilter);
  const flat = flattenTree(visualRoot);
  const allNodes = collectAllNodes(visualRoot);
  const nodeMap = new Map<string, TopicNode>();
  for (const n of allNodes) {
    nodeMap.set(n.id, n);
  }

  const now = Date.now();

  const graphNodes: GraphNode[] = flat.map((f) => {
    const tn = nodeMap.get(f.nodeId)!;
    const r = calculateRadius(ancestorPulse ? tn.aggregateRate : tn.messageRate) * nodeScale;
    return {
      id: f.nodeId,
      label: f.label,
      radius: r,
      displayRadius: r,
      messageRate: tn.messageRate,
      aggregateRate: tn.aggregateRate,
      depth: f.depth,
      pulse: now - tn.lastTimestamp < pulseDuration,
      pulseTimestamp: tn.lastTimestamp,
      pulseRate: tn.pulseRate,
      payloadTags: tn.payloadTags ? tn.payloadTags.map((t) => t.tag) : null,
    };
  });

  // Build a map of node pulse state for link lookup
  const nodePulseMap = new Map<string, { pulse: boolean; pulseTimestamp: number }>();
  for (const gn of graphNodes) {
    nodePulseMap.set(gn.id, { pulse: gn.pulse, pulseTimestamp: gn.pulseTimestamp });
  }

  const graphLinks: GraphLink[] = flat
    .filter((f) => f.parentId !== null)
    .map((f) => {
      const src = nodePulseMap.get(f.parentId!);
      const tgt = nodePulseMap.get(f.nodeId);
      // Both endpoints must be pulsing for the link to pulse.
      // This ensures only links on the ancestor chain (root → leaf) light up,
      // not sibling branches that happen to share a pulsing ancestor.
      const bothPulsing = (src?.pulse ?? false) && (tgt?.pulse ?? false);
      return {
        source: f.parentId!,
        target: f.nodeId,
        pulse: bothPulsing,
        pulseTimestamp: bothPulsing
          ? Math.max(src?.pulseTimestamp ?? 0, tgt?.pulseTimestamp ?? 0)
          : 0,
      };
    });

  return { graphNodes, graphLinks };
}

/** Maximum number of nodes that retain their last payload (LRU eviction). */
const PAYLOAD_LRU_CAP = 200;

/** Maximum number of simultaneously highlighted nodes. Excess entries are silently truncated. */
const MAX_HIGHLIGHTED_NODES = 200;

/** Maximum characters stored per payload at ingest. */
export const PAYLOAD_MAX_STORE = 2048;

/**
 * LRU tracker for payload storage. Insertion-ordered Set of node IDs.
 * Most-recently-used entry is last. When the set exceeds PAYLOAD_LRU_CAP,
 * the first (oldest) entry is evicted and its lastPayload is set to null.
 * Lives outside the store to avoid Zustand re-render triggers.
 */
const _payloadLru = new Set<string>();

/**
 * Merge one detector result onto a node's payloadTags, replacing any existing
 * tag of the same type (same semantics as setPayloadTags' merge).
 */
function mergeNodeTag(node: TopicNode, result: DetectorResult): void {
  const preserved = node.payloadTags?.filter((t) => t.tag !== result.tag) ?? [];
  node.payloadTags = [...preserved, result];
}

/** Maximum tracked sparkplug devices — matches the documented SVG node ceiling. */
const SPARKPLUG_DEVICES_CAP = 1000;

/**
 * Maximum topic tree nodes. Beyond this, messages for NEW topics are dropped
 * (existing topics keep updating) and a banner tells the user to narrow the
 * filter. Protective: the SVG/force-simulation pipeline degrades hard past
 * ~1000 nodes (d3 tick ~87 ms at ~9000), so growing further only deepens an
 * already-unusable graph. Pruning frees capacity again.
 */
export const TOPIC_NODE_CAP = 2000;

/**
 * Live count of non-root tree nodes. Maintained incrementally (O(1) per
 * message) because totalTopics is cumulative and never decremented by prune.
 */
let _treeNodeCount = 0;

/**
 * Sparkplug version-bump batching. Per-message zustand set() calls bypass the
 * store's rAF batching and were the primary cause of retained-burst slowdown:
 * each bump re-runs the TopicGraph offline-set effect and renderer restyle.
 * Instead, mutations mark this flag and the next rAF flush (or rebuildGraph()
 * in tests) bumps sparkplugVersion once for the whole batch.
 */
let _sparkplugDirty = false;
/** Wall-clock ms of the last sparkplugVersion bump (heartbeat gating). */
let _lastSparkplugVersionBump = 0;
/** One-time warning latch for the device cap. */
let _sparkplugCapWarned = false;
/**
 * Heartbeat interval for non-material sparkplug updates (steady-state DATA):
 * keeps SparkplugDevicePanel timestamps visibly live (~1 Hz) without bumping
 * the version 60x/s.
 */
const SPARKPLUG_HEARTBEAT_MS = 1000;

/**
 * Metric history for sparklines — recorded ONLY while a device panel is open
 * (zero ambient cost; the sparkline starts empty on open). One device at a
 * time; module-level because samples arrive between version bumps and the
 * panel reads them on its batched re-renders.
 */
let _sparkplugHistoryDevice: string | null = null;
const _sparkplugHistory = new Map<string, MetricSample[]>();

/**
 * Entity registry maps (reverse topic index, tombstone/cleanup tracking).
 * The entities Map itself lives in the store (domainEntities) for React
 * subscriptions; these lookup structures stay module-level like the other
 * non-reactive state. Version bumps are batched via _entitiesDirty, drained
 * by the rAF flush / rebuildGraph exactly like the sparkplug flag.
 */
const _entityRegistry = createEntityRegistry();
let _homieState = createHomieState();
let _entitiesDirty = false;

/**
 * Apply a Sparkplug message's lifecycle effect: update the device state
 * slice, cascade NDEATH to the edge's devices, and synchronously attach a
 * slim sparkplug tag to the topic node (instant indicator ring — no worker
 * round-trip needed). Version bumps are BATCHED: material changes (device
 * created, online flipped, family node added, death cascade) mark the dirty
 * flag for the next rAF flush; steady-state DATA only dirties on the
 * heartbeat so its timestamps still reach the UI at ~1 Hz.
 */
function recordSparkplugMessage(
  get: () => TopicStoreState,
  node: TopicNode,
  info: SparkplugTopicInfo,
): void {
  const devices = get().sparkplugDevices;
  const key = sparkplugDeviceKey(info);
  if (key === null) return;

  // Cap tracked devices — beyond this the graph itself is unusable anyway.
  if (!devices.has(key) && devices.size >= SPARKPLUG_DEVICES_CAP) {
    if (!_sparkplugCapWarned) {
      _sparkplugCapWarned = true;
      console.warn(
        `[sparkplug] Device cap (${SPARKPLUG_DEVICES_CAP}) reached — new devices are no longer tracked.`,
      );
    }
    return;
  }

  const result = applySparkplugLifecycle(devices.get(key), info, node.id, Date.now());
  if (!result) return;
  const { state: deviceState, changed } = result;
  devices.set(key, deviceState);

  // An edge node's death takes all its devices down with it (their MQTT
  // session died together — Sparkplug spec semantics).
  let cascaded = false;
  if (info.messageType === "NDEATH") {
    cascaded = cascadeEdgeDeath(devices, info.groupId, info.edgeNodeId).length > 0;
  }

  mergeNodeTag(node, {
    tag: "sparkplug",
    confidence: 1,
    fieldPath: "",
    metadata: {
      deviceKey: key,
      role: deviceState.role,
      messageType: info.messageType,
      online: deviceState.online,
      metricCount: deviceState.metrics.size,
    } satisfies SparkplugMetadata,
  });

  if (
    changed ||
    cascaded ||
    Date.now() - _lastSparkplugVersionBump > SPARKPLUG_HEARTBEAT_MS
  ) {
    _sparkplugDirty = true;
  }
}

/**
 * A node was pruned: clean up ecosystem references to it so highlights and
 * anchors never point at ghosts. Entity/device DEFINITIONS deliberately
 * survive pruning (HA configs are retained one-shots; sparkplug devices show
 * offline) — only the per-node references go.
 */
function cleanupPrunedNodeReferences(
  nodeId: string,
  devices: Map<string, SparkplugDeviceState>,
): void {
  if (removeEntityNodeRef(_entityRegistry, nodeId)) _entitiesDirty = true;

  if (isSparkplugTopic(nodeId)) {
    const info = parseSparkplugTopic(nodeId);
    const key = info && info.messageType !== "STATE" ? sparkplugDeviceKey(info) : null;
    const device = key !== null ? devices.get(key) : undefined;
    if (device?.topicNodeIds.delete(nodeId)) _sparkplugDirty = true;
  }
}

/** Walk the topic tree and revoke all image blob URLs. Called on reset/disconnect. */
function revokeAllBlobUrls(node: TopicNode): void {
  if (node.lastImageBlobUrl) {
    URL.revokeObjectURL(node.lastImageBlobUrl);
    node.lastImageBlobUrl = null;
  }
  for (const child of node.children.values()) {
    revokeAllBlobUrls(child);
  }
}

/**
 * Module-level state for the batched rebuild scheduler.
 * Lives outside the store to avoid Zustand re-render triggers.
 */
let _rebuildScheduled = false;
let _rebuildStructural = false;
let _rebuildRafId: number | null = null;

/**
 * Pending counter deltas accumulated across messages within the current rAF batch.
 * Flushed into Zustand state in the scheduleRebuild rAF callback alongside the
 * graph data — collapses N set() calls per frame down to 1.
 */
let _pendingMessages = 0;
let _pendingNewTopics = 0;

/**
 * Bounded rolling buffer of recent messages, for the Stats dashboard's windowed
 * views (previous minute / 5 minutes). Each entry is tiny ({topic, size, ts}).
 * The buffer is capped by count (trimmed in batches to keep the push O(1)
 * amortized); the panel filters by timestamp at read time, so stale entries
 * beyond a window are simply ignored. "Since connect" stats use cumulative
 * per-node data instead, so this only needs to span the longest window (5 min).
 */
export interface RecentMessage {
  topic: string;
  size: number;
  ts: number;
}
const MAX_RECENT_MESSAGES = 50_000;
const RECENT_TRIM_BATCH = 5_000;
let _recentMessages: RecentMessage[] = [];

/** Live snapshot of the recent-message buffer (oldest first). Read-only. */
export function getRecentMessages(): readonly RecentMessage[] {
  return _recentMessages;
}

/**
 * Apply parsed entity declarations to the registry and, when following is
 * enabled, subscribe to declared state/availability topics the primary filter
 * doesn't already cover. Shared by the worker result path (setPayloadTags) and
 * the registry-only burst ingest below. Returns whether the registry changed.
 */
function applyDeclarationsAndFollow(
  declarations: EntityDeclaration[],
  state: TopicStoreState,
): boolean {
  if (declarations.length === 0) return false;
  const changed = applyEntityDeclarations(_entityRegistry, declarations);
  if (state.followEcosystemTopics) {
    const uncovered = collectDeclaredTopics(declarations).filter(
      (topic) => !mqttTopicMatches(state.topicFilter, topic),
    );
    if (uncovered.length > 0) mqttService.followTopics(uncovered);
  }
  return changed;
}

/**
 * Feed an ecosystem-defining topic into the entity registry WITHOUT creating a
 * graph node — used during the retained-burst drop so identity is captured but
 * the config topics don't clutter the graph. The topic is passed as the node id
 * (node ids are topic paths), so any future real node binds consistently.
 * Returns whether the registry changed.
 */
function ingestDefiningTopic(topic: string, payload: string, state: TopicStoreState): boolean {
  if (isHaDiscoveryTopic(topic)) {
    if (payload.length === 0) return applyConfigTombstone(_entityRegistry, topic);
    return applyDeclarationsAndFollow(parseHaDiscovery(topic, payload), state);
  }
  if (isShellyAnnounceTopic(topic)) {
    return applyDeclarationsAndFollow(parseShellyAnnounce(topic, payload), state);
  }
  if (isHomieAttributeTopic(topic)) {
    return recordHomieMessage(_entityRegistry, _homieState, topic, topic, payload)?.changed ?? false;
  }
  return false;
}

/**
 * Burst throttle — reduces the frequency of structural (D3 data-join) rebuilds
 * during the initial retained-message flood after connecting.
 *
 * For the first BURST_WINDOW_MS after connection, structural rebuilds are
 * throttled to fire at most once every BURST_STRUCTURAL_INTERVAL_MS.
 * Rate-only updates continue per-frame as normal.
 */
const BURST_WINDOW_MS = 10_000;
const BURST_STRUCTURAL_INTERVAL_MS = 250;
let _burstWindowStart = 0;
let _lastStructuralFlush = 0;
let _burstThrottleId: ReturnType<typeof setTimeout> | null = null;
/** Timer that clears `burstWindowActive` after the burst window expires. */
let _burstActiveTimeoutId: ReturnType<typeof setTimeout> | null = null;

export const useTopicStore = create<TopicStoreState>((set, get) => {
  const cfg = getConfig();
  // Merge saved settings (localStorage) → config.json → hardcoded fallback.
  // Connection parameters (brokerUrl, topicFilter, etc.) are persisted
  // separately by useMqttClient under "mqtt_connection".
  const saved = loadSavedSettings();
  return {
  root: createTopicNode("", ""),
  graphNodes: [],
  graphLinks: [],
  connectionStatus: "disconnected",
  totalMessages: 0,
  totalTopics: 0,
  sessionStart: Date.now(),
  errorMessage: null,
  emaTau:               saved.emaTau             ?? cfg.emaTau             ?? DEFAULT_EMA_TAU,
  showLabels:           saved.showLabels          ?? cfg.showLabels          ?? true,
  labelDepthFactor:     saved.labelDepthFactor    ?? cfg.labelDepthFactor    ?? 2,
  labelMode:            saved.labelMode           ?? ((cfg.labelMode === "depth" || cfg.labelMode === "zoom" ? cfg.labelMode : "activity") as LabelMode),
  labelFontSize:        saved.labelFontSize       ?? cfg.labelFontSize       ?? 15,
  labelStrokeWidth:     saved.labelStrokeWidth    ?? cfg.labelStrokeWidth    ?? 9.0,
  scaleTextByDepth:     saved.scaleTextByDepth    ?? cfg.scaleTextByDepth    ?? true,
  showTooltips:         saved.showTooltips        ?? cfg.showTooltips        ?? true,
  clearOnDisconnect:    saved.clearOnDisconnect   ?? cfg.clearOnDisconnect   ?? true,
  nodeScale:            saved.nodeScale           ?? cfg.nodeScale           ?? 2.5,
  scaleNodeSizeByDepth: saved.scaleNodeSizeByDepth ?? cfg.scaleNodeSizeByDepth ?? true,
  repulsionStrength:    saved.repulsionStrength   ?? cfg.repulsionStrength   ?? -350,
  linkDistance:         saved.linkDistance        ?? cfg.linkDistance        ?? 155,
  isShaking: false,
  linkStrength:         saved.linkStrength        ?? cfg.linkStrength        ?? 0.3,
  collisionPadding:     saved.collisionPadding    ?? cfg.collisionPadding    ?? 13,
  alphaDecay:           saved.alphaDecay          ?? cfg.alphaDecay          ?? 0.01,
  pruneTimeout:         saved.pruneTimeout        ?? cfg.pruneTimeout        ?? 0,
  dropRetainedBurst: saved.dropRetainedBurst ?? cfg.dropRetainedBurst ?? true,
  burstWindowDuration:  saved.burstWindowDuration  ?? cfg.burstWindowDuration  ?? 5_000,
  showGeoIndicators:    saved.showGeoIndicators    ?? cfg.showGeoIndicators    ?? true,
  showImageIndicators:  saved.showImageIndicators  ?? cfg.showImageIndicators  ?? true,
  showSparkplugIndicators: saved.showSparkplugIndicators ?? cfg.showSparkplugIndicators ?? true,
  showHomeAssistantIndicators: saved.showHomeAssistantIndicators ?? cfg.showHomeAssistantIndicators ?? true,
  showFrigateIndicators: saved.showFrigateIndicators ?? cfg.showFrigateIndicators ?? true,
  showShellyIndicators:  saved.showShellyIndicators  ?? cfg.showShellyIndicators  ?? true,
  showOwnTracksIndicators: saved.showOwnTracksIndicators ?? cfg.showOwnTracksIndicators ?? true,
  showTtnIndicators: saved.showTtnIndicators ?? cfg.showTtnIndicators ?? true,
  showChirpstackIndicators: saved.showChirpstackIndicators ?? cfg.showChirpstackIndicators ?? true,
  showHomieIndicators: saved.showHomieIndicators ?? cfg.showHomieIndicators ?? true,
  showOpenDtuIndicators: saved.showOpenDtuIndicators ?? cfg.showOpenDtuIndicators ?? true,
  showTasmotaIndicators: saved.showTasmotaIndicators ?? cfg.showTasmotaIndicators ?? true,
  fadeIndicatorRings: saved.fadeIndicatorRings ?? cfg.fadeIndicatorRings ?? true,
  followEcosystemTopics: saved.followEcosystemTopics ?? cfg.followEcosystemTopics ?? true,
  ancestorPulse:        saved.ancestorPulse       ?? cfg.ancestorPulse       ?? true,
  showRootPath:         saved.showRootPath        ?? cfg.showRootPath        ?? false,
  topicFilter: cfg.topicFilter ?? "#",
  graphStructureVersion: 0,
  exportRequested: 0,
  sparkplugDevices: new Map<string, SparkplugDeviceState>(),
  sparkplugVersion: 0,
  // The registry's entities Map IS the store slice — mutated in place,
  // entitiesVersion drives React re-renders.
  domainEntities: _entityRegistry.entities,
  entitiesVersion: 0,
  nodeCapReached: false,
  selectedNodeId: null,
  displayMode: resolveInitialDisplayMode(cfg),
  centerNodeId: null,
  centerNodeNonce: 0,
  fitViewNonce: 0,
  fitViewDuration: 1000,
  highlightedNodes: new Map<string, string>(),
  burstWindowActive: false,
  burstSettingsLocked: false,

  handleMessage: (topic: string, payload: string, qos: 0 | 1 | 2, retain = false, userProperties?: MqttUserProperties, imageBlobUrl?: string, rawPayload?: ArrayBuffer) => {
    perfMark("handle-msg-start");
    const state = get();

    // Fully drop retained messages during the post-subscribe burst window so
    // the graph doesn't explode with stale retained data. Ecosystem-defining
    // topics (HA discovery configs, Shelly announces, Homie attributes) are
    // still fed into the entity registry — but WITHOUT a graph node — so
    // identity is captured while the config topics stay out of the graph.
    const inBurstWindow = _burstWindowStart > 0
      && (Date.now() - _burstWindowStart < state.burstWindowDuration);
    if (state.dropRetainedBurst && retain && inBurstWindow) {
      if (isEcosystemDefiningTopic(topic) && ingestDefiningTopic(topic, payload, state)) {
        _entitiesDirty = true;
        get().scheduleRebuild(false); // batched; drains _entitiesDirty → bumps entitiesVersion
      }
      if (imageBlobUrl) URL.revokeObjectURL(imageBlobUrl);
      return;
    }

    const root = state.root;

    // Topic node cap: when the tree is full, drop messages for topics that
    // would create new nodes. Existing topics keep updating normally, and
    // pruning frees capacity again. The banner flag is recomputed on flush.
    if (_treeNodeCount >= TOPIC_NODE_CAP) {
      const segments = topic === "" ? [] : topic.split("/");
      if (!findNode(root, segments)) {
        if (imageBlobUrl) URL.revokeObjectURL(imageBlobUrl);
        return;
      }
    }

    const { node, newNodes } = ensureTopicPathTracked(root, topic);
    _treeNodeCount += newNodes;

    node.messageCount += 1;
    node.lastTimestamp = Date.now();
    node.lastQoS = qos;
    node.lastUserProperties = userProperties ?? null;

    // Track payload sizes unconditionally — independent of tooltip/LRU settings
    // so size history is always available for debugging and WebMCP queries.
    node.lastPayloadSize = payload.length;
    node.largestPayloadSize = Math.max(node.largestPayloadSize, payload.length);

    // Rolling buffer for the Stats dashboard's windowed views. Trimmed in
    // batches so the per-message cost stays O(1) amortized.
    _recentMessages.push({ topic, size: payload.length, ts: node.lastTimestamp });
    if (_recentMessages.length > MAX_RECENT_MESSAGES) {
      _recentMessages.splice(0, _recentMessages.length - (MAX_RECENT_MESSAGES - RECENT_TRIM_BATCH));
    }

    // Store image blob URL — revoke the previous one to prevent memory leaks.
    if (imageBlobUrl) {
      if (node.lastImageBlobUrl) URL.revokeObjectURL(node.lastImageBlobUrl);
      node.lastImageBlobUrl = imageBlobUrl;
    }

    // Only store payloads when tooltips are enabled (opt-in).
    // Use LRU eviction to cap the number of stored payloads.
    if (state.showTooltips) {
      // The selected node bypasses truncation so the DetailPanel can show
      // the full payload and JSON pretty-print works for large objects.
      const isSelected = node.id === state.selectedNodeId;
      node.lastPayload = (!isSelected && payload.length > PAYLOAD_MAX_STORE)
        ? payload.slice(0, PAYLOAD_MAX_STORE)
        : payload;

      // Move this node to the most-recent position in the LRU set
      _payloadLru.delete(node.id);
      _payloadLru.add(node.id);

      // Evict the oldest entry if over the cap.
      // Skip the selected node — it is pinned for the duration of selection.
      if (_payloadLru.size > PAYLOAD_LRU_CAP) {
        const selectedId = state.selectedNodeId;
        for (const candidateId of _payloadLru) {
          if (candidateId === selectedId) continue;
          _payloadLru.delete(candidateId);
          const segments = candidateId === "" ? [] : candidateId.split("/");
          const evicted = findNode(root, segments);
          if (evicted) {
            evicted.lastPayload = null;
            // Revoke blob URL on eviction to free memory
            if (evicted.lastImageBlobUrl) {
              URL.revokeObjectURL(evicted.lastImageBlobUrl);
              evicted.lastImageBlobUrl = null;
            }
          }
          break;
        }
      }
    }

    // Sparkplug B: lifecycle (online/offline) is applied synchronously from
    // the topic shape alone — BIRTH/DEATH ordering must not be lost to the
    // analyzer's per-node debounce, and no payload decode is needed for it.
    // Metric decoding still happens in the worker (rawPayload below).
    const spInfo = isSparkplugTopic(topic) ? parseSparkplugTopic(topic) : null;
    if (spInfo && spInfo.messageType !== "STATE") {
      recordSparkplugMessage(get, node, spInfo);
    }

    // Entity registry: an empty retained payload on a defining topic is a
    // tombstone (HA: "entity deleted") — handled here because empty payloads
    // never reach the analyzer worker.
    if (payload.length === 0 && isHaDiscoveryTopic(topic)) {
      if (applyConfigTombstone(_entityRegistry, topic)) _entitiesDirty = true;
    }

    // Entity registry: messages on claimed topics (declared state/
    // availability topics, possibly in other subtrees) bind the node to its
    // entity, set the anchor, and flip availability — synchronously, like
    // sparkplug lifecycle, so ordering is not lost to the analyzer debounce.
    const hit = recordEntityTopicHit(_entityRegistry, topic, node.id, payload);
    if (hit) {
      mergeNodeTag(node, {
        // The reverse index serves every declaration-based ecosystem; tag with
        // the bound entity's own ecosystem (Home Assistant, Homie, ...).
        tag: hit.entity.ecosystem as "homeassistant" | "homie",
        confidence: 1,
        fieldPath: "",
        metadata: {
          entityKey: hit.entity.key,
          role: hit.entity.role,
          label: hit.entity.label,
          online: hit.entity.online,
        } satisfies EntityTagMetadata,
      });
      if (hit.changed) _entitiesDirty = true;
    }

    // Structural providers: ecosystems whose topic SHAPE is the signal
    // (Frigate cameras, Shelly device trees) — entities derived per message,
    // no defining document round-trip needed.
    const structuralHit =
      recordFrigateMessage(_entityRegistry, topic, node.id, payload) ??
      recordShellyMessage(_entityRegistry, topic, node.id, payload) ??
      recordOwnTracksMessage(_entityRegistry, topic, node.id, payload) ??
      recordLorawanMessage(_entityRegistry, topic, node.id, payload) ??
      recordOpenDtuMessage(_entityRegistry, topic, node.id, payload) ??
      recordTasmotaMessage(_entityRegistry, topic, node.id, payload);
    if (structuralHit) {
      mergeNodeTag(node, {
        tag: structuralHit.entity.ecosystem as
          | "frigate"
          | "shelly"
          | "owntracks"
          | "ttn"
          | "chirpstack"
          | "opendtu"
          | "tasmota",
        confidence: 1,
        fieldPath: "",
        metadata: {
          entityKey: structuralHit.entity.key,
          role: structuralHit.entity.role,
          label: structuralHit.entity.label,
          online: structuralHit.entity.online,
        } satisfies EntityTagMetadata,
      });
      if (structuralHit.changed) _entitiesDirty = true;
    }

    // Homie: a `$`-attribute accumulates the device → node model (declaration
    // spread across many retained topics). Property value topics bind via the
    // recordEntityTopicHit path above once declared.
    const homieHit = recordHomieMessage(_entityRegistry, _homieState, topic, node.id, payload);
    if (homieHit) {
      mergeNodeTag(node, {
        tag: "homie",
        confidence: 1,
        fieldPath: "",
        metadata: {
          entityKey: homieHit.entity.key,
          role: homieHit.entity.role,
          label: homieHit.entity.label,
          online: homieHit.entity.online,
        } satisfies EntityTagMetadata,
      });
      if (homieHit.changed) _entitiesDirty = true;
    }

    // Submit payload for off-thread analysis (geo detection, image detection,
    // etc.).  Every non-empty payload is submitted — the 500ms per-node
    // debounce in payloadAnalyzerService prevents flooding the worker on
    // high-frequency topics.  Results are merged (not replaced) in
    // setPayloadTags, so tags from different payload types coexist.
    // Sparkplug BIRTH/DEATH bypass the debounce so the worker's alias maps
    // stay warm — EXCEPT during the retained-burst window, where thousands of
    // retained BIRTHs would each post synchronously. Debouncing them is safe:
    // BIRTH and DATA arrive on different topic nodes, so the per-node debounce
    // can only coalesce BIRTH-over-BIRTH (latest wins, which is correct).
    if (payload.length > 0 || rawPayload) {
      payloadAnalyzer.analyze(node.id, topic, payload, {
        rawBytes: rawPayload,
        immediate:
          spInfo !== null &&
          (isBirth(spInfo.messageType) || isDeath(spInfo.messageType)) &&
          !inBurstWindow,
      });
    }

    // Instant rate spike: add 1 message worth of rate contribution
    // The EMA decay will smooth this out over subsequent ticks
    node.messageRate += 1;

    // Snapshot the peak rate at pulse time for fade colour interpolation.
    // This value persists so the renderer can fade from a meaningful warm
    // colour even after EMA decay has pulled messageRate back toward zero.
    node.pulseRate = node.messageRate;

    // Propagate pulse timestamp up the ancestor chain if enabled
    if (state.ancestorPulse) {
      const now = node.lastTimestamp;
      const ancestorPaths = getAncestorPaths(topic);
      for (const path of ancestorPaths) {
        // Look up existing ancestor node by walking the tree (don't create new nodes)
        const segments = path === "" ? [] : path.split("/");
        let ancestor: TopicNode | undefined = root;
        for (const seg of segments) {
          ancestor = ancestor.children.get(seg);
          if (!ancestor) break;
        }
        if (ancestor) {
          ancestor.lastTimestamp = now;
          // Snapshot aggregate rate for ancestor fade colour.
          // Use max(..., 1) because bottom-up aggregation hasn't run yet
          // for this tick, so aggregateRate may be stale. The 1 guarantees
          // at least a visible warm colour ("something happened in my subtree").
          ancestor.pulseRate = Math.max(ancestor.aggregateRate, 1);
        }
      }
    }

    // Accumulate counter deltas — flushed in the rAF callback alongside the graph rebuild.
    // This collapses N Zustand set() calls per frame (one per message) into 1,
    // eliminating per-message React re-render notifications for the status bar counters.
    _pendingMessages += 1;
    _pendingNewTopics += newNodes;

    // Schedule a batched graph rebuild instead of rebuilding immediately.
    // Multiple messages within the same animation frame are coalesced into one rebuild.
    get().scheduleRebuild(newNodes > 0);

    perfMark("handle-msg-end");
    perfMeasure("handle-message", "handle-msg-start", "handle-msg-end");
  },

  wouldDropRetained: () => {
    const state = get();
    return (
      state.dropRetainedBurst &&
      _burstWindowStart > 0 &&
      Date.now() - _burstWindowStart < state.burstWindowDuration
    );
  },

  startSparkplugHistory: (deviceKey: string) => {
    _sparkplugHistoryDevice = deviceKey;
    _sparkplugHistory.clear();
  },

  stopSparkplugHistory: () => {
    _sparkplugHistoryDevice = null;
    _sparkplugHistory.clear();
  },

  getSparkplugHistory: (metricName: string) => {
    return _sparkplugHistory.get(metricName);
  },

  setConnectionStatus: (status: ConnectionStatus, error?: string) => {
    // Start burst throttle window on successful connection.
    // The first ~10 s of retained messages will have structural rebuilds
    // throttled to reduce CPU/visual chaos.
    if (status === "connected") {
      _burstWindowStart = Date.now();
      _lastStructuralFlush = 0;
    }

    // Burst UI state — lock settings and show indicator when drop is enabled.
    const burstUpdates: Partial<TopicStoreState> = {};
    if (status === "connected") {
      const state = get();
      if (state.dropRetainedBurst) {
        burstUpdates.burstWindowActive = true;
        burstUpdates.burstSettingsLocked = true;
        // Clear any stale timer from a previous connection
        if (_burstActiveTimeoutId !== null) clearTimeout(_burstActiveTimeoutId);
        _burstActiveTimeoutId = setTimeout(() => {
          _burstActiveTimeoutId = null;
          set({ burstWindowActive: false });
        }, state.burstWindowDuration);
      }
    } else if (status === "disconnected") {
      // Unlock settings and clear indicator on disconnect
      burstUpdates.burstWindowActive = false;
      burstUpdates.burstSettingsLocked = false;
      if (_burstActiveTimeoutId !== null) {
        clearTimeout(_burstActiveTimeoutId);
        _burstActiveTimeoutId = null;
      }
    }

    set({
      connectionStatus: status,
      // Preserve the last error message across reconnect-loop status changes
      // ("close" → "disconnected", "reconnect" → "connecting") so the user
      // doesn't see it flicker off every 5 seconds.
      // Only clear it on successful connection or when a new error arrives.
      // Empty string is used as an explicit "clear error" signal (e.g. user disconnect).
      // undefined means "no update" — preserve the last error across reconnect loops.
      errorMessage: error !== undefined
        ? (error || null)                // new error or explicit clear ("" → null)
        : status === "connected"
          ? null                         // success — clear
          : get().errorMessage,          // all other transitions — preserve
      ...(status === "connected" ? { sessionStart: Date.now() } : {}),
      ...burstUpdates,
    });
  },

  decayTick: () => {
    perfMark("decay-tick-start");
    const state = get();
    const root = state.root;
    const dt = DECAY_INTERVAL / 1000; // seconds
    const alpha = 1 - Math.exp(-dt / state.emaTau);

    // Decay all nodes' rates and propagate aggregates bottom-up
    function decayNode(node: TopicNode): number {
      // Decay this node's direct rate toward zero
      // Target is 0 (no new messages), EMA pulls toward target
      node.messageRate = node.messageRate * (1 - alpha);

      // Clamp very small values to zero to avoid floating-point noise
      if (node.messageRate < 0.001) {
        node.messageRate = 0;
      }

      // Recurse into children and sum their aggregate rates
      let childAggregateSum = 0;
      for (const child of node.children.values()) {
        childAggregateSum += decayNode(child);
      }

      node.aggregateRate = node.messageRate + childAggregateSum;
      return node.aggregateRate;
    }

    decayNode(root);

    // Prune stale nodes (if enabled).
    // After the retained-message burst on initial subscribe, many topics may
    // never publish again. Pruning removes them after pruneTimeout ms so the
    // graph converges on the live topic tree.
    const pruneTimeout = state.pruneTimeout;
    if (pruneTimeout > 0) {
      const now = Date.now();
      const selectedId = state.selectedNodeId;

      /** Bottom-up walk: returns true if the caller should delete this child. */
      function pruneNode(node: TopicNode): boolean {
        // Recurse children first — deepest nodes pruned before parents
        for (const [segment, child] of node.children) {
          if (pruneNode(child)) {
            // Release per-node resources before dropping the reference:
            // blob URLs leak otherwise, and stale LRU entries would count
            // against the payload cap forever.
            if (child.lastImageBlobUrl) {
              URL.revokeObjectURL(child.lastImageBlobUrl);
              child.lastImageBlobUrl = null;
            }
            _payloadLru.delete(child.id);
            cleanupPrunedNodeReferences(child.id, state.sparkplugDevices);
            node.children.delete(segment);
            _treeNodeCount -= 1;
          }
        }
        // Never prune the root or the currently selected node
        if (node.id === "" || node.id === selectedId) return false;
        // Only prune leaf nodes (children already cleaned up above)
        if (node.children.size > 0) return false;
        // Prune if: received messages but now stale, OR never received
        // any message directly (implicit ancestor, now childless)
        const isStale = node.lastTimestamp > 0 && now - node.lastTimestamp > pruneTimeout;
        const isImplicitLeaf = node.messageCount === 0;
        return isStale || isImplicitLeaf;
      }

      pruneNode(root);
    }

    // Pulse duration equals tau in milliseconds — "Fade Time = 5s" means 5s fade
    const pulseDuration = state.emaTau * 1000;

    // Skip rebuilding graph data if a structural rAF rebuild is already pending.
    // The rAF callback will call buildGraphData() + set() moments later, so doing
    // it here too is pure duplicate work during a burst. Rate decay above has
    // already run (the tree is updated), which is what matters for correctness.
    if (!(_rebuildScheduled && _rebuildStructural)) {
      const { graphNodes, graphLinks } = buildGraphData(
        root, pulseDuration, state.showRootPath, state.topicFilter, state.ancestorPulse, state.nodeScale
      );
      set({ graphNodes, graphLinks });
    }

    perfMark("decay-tick-end");
    perfStats.lastDecayTickMs = perfMeasure("decay-tick", "decay-tick-start", "decay-tick-end");
  },

  rebuildGraph: () => {
    // Cancel any pending rAF and clear the scheduling flags.
    // rebuildGraph() is the synchronous stand-in for the rAF callback used in tests,
    // so it must fully replicate what the rAF callback does — including clearing the
    // flags so that a subsequent decayTick() can safely rebuild graph data.
    if (_rebuildRafId !== null) {
      cancelAnimationFrame(_rebuildRafId);
      _rebuildRafId = null;
    }
    if (_burstThrottleId !== null) {
      clearTimeout(_burstThrottleId);
      _burstThrottleId = null;
    }
    const wasStructural = _rebuildStructural;
    _rebuildScheduled = false;
    _rebuildStructural = false;

    const state = get();
    const pulseDuration = state.emaTau * 1000;
    const { graphNodes, graphLinks } = buildGraphData(
      state.root, pulseDuration, state.showRootPath, state.topicFilter, state.ancestorPulse, state.nodeScale
    );
    // Also drain any pending counter deltas (mirrors the rAF callback behaviour).
    // This ensures tests that call rebuildGraph() as a synchronous rAF stand-in
    // see correct totalMessages/totalTopics values immediately.
    const pendingMsgs = _pendingMessages;
    const pendingTopics = _pendingNewTopics;
    _pendingMessages = 0;
    _pendingNewTopics = 0;
    // Drain the batched sparkplug/entity version bumps (mirrors the rAF callback).
    const sparkplugWasDirty = _sparkplugDirty;
    _sparkplugDirty = false;
    if (sparkplugWasDirty) _lastSparkplugVersionBump = Date.now();
    const entitiesWasDirty = _entitiesDirty;
    _entitiesDirty = false;
    set({
      graphNodes,
      graphLinks,
      ...(wasStructural
        ? { graphStructureVersion: state.graphStructureVersion + 1 }
        : {}),
      totalMessages: state.totalMessages + pendingMsgs,
      totalTopics: state.totalTopics + pendingTopics,
      sparkplugVersion: sparkplugWasDirty
        ? state.sparkplugVersion + 1
        : state.sparkplugVersion,
      entitiesVersion: entitiesWasDirty
        ? state.entitiesVersion + 1
        : state.entitiesVersion,
      nodeCapReached: _treeNodeCount >= TOPIC_NODE_CAP,
    });
  },

  scheduleRebuild: (structural: boolean) => {
    // Accumulate: if any call in the batch is structural, the flush is structural
    if (structural) _rebuildStructural = true;

    // Burst throttle: during the first BURST_WINDOW_MS after connection,
    // defer structural rebuilds so they fire at most once every
    // BURST_STRUCTURAL_INTERVAL_MS.  This reduces the number of expensive
    // D3 data joins from ~600 to ~40 during a retained-message flood.
    const now = Date.now();
    const inBurstWindow = _burstWindowStart > 0
      && now - _burstWindowStart < BURST_WINDOW_MS;

    if (inBurstWindow && _rebuildStructural) {
      const elapsed = now - _lastStructuralFlush;
      if (elapsed < BURST_STRUCTURAL_INTERVAL_MS) {
        // Too soon since last structural flush — schedule a deferred retry
        if (_burstThrottleId === null) {
          _burstThrottleId = setTimeout(() => {
            _burstThrottleId = null;
            // Re-enter to trigger the normal rAF path
            get().scheduleRebuild(false);
          }, BURST_STRUCTURAL_INTERVAL_MS - elapsed);
        }
        return;
      }
    }

    if (!_rebuildScheduled) {
      _rebuildScheduled = true;
      _rebuildRafId = requestAnimationFrame(() => {
        perfMark("rebuild-start");
        _rebuildScheduled = false;
        _rebuildRafId = null;
        const wasStructural = _rebuildStructural;
        _rebuildStructural = false;

        const s = get();
        const pulseDuration = s.emaTau * 1000;
        const { graphNodes, graphLinks } = buildGraphData(
          s.root, pulseDuration, s.showRootPath, s.topicFilter, s.ancestorPulse, s.nodeScale
        );

        // Drain accumulated counter deltas and fold into this single set() call.
        // This collapses N per-message set() calls into 1 per animation frame.
        const pendingMsgs = _pendingMessages;
        const pendingTopics = _pendingNewTopics;
        _pendingMessages = 0;
        _pendingNewTopics = 0;
        // Drain the batched sparkplug/entity version bumps (keep in sync with rebuildGraph()).
        const sparkplugWasDirty = _sparkplugDirty;
        _sparkplugDirty = false;
        if (sparkplugWasDirty) _lastSparkplugVersionBump = Date.now();
        const entitiesWasDirty = _entitiesDirty;
        _entitiesDirty = false;

        set({
          graphNodes,
          graphLinks,
          // Only bump version when structure actually changed (new/removed nodes)
          graphStructureVersion: wasStructural
            ? s.graphStructureVersion + 1
            : s.graphStructureVersion,
          totalMessages: s.totalMessages + pendingMsgs,
          totalTopics: s.totalTopics + pendingTopics,
          sparkplugVersion: sparkplugWasDirty
            ? s.sparkplugVersion + 1
            : s.sparkplugVersion,
          entitiesVersion: entitiesWasDirty
            ? s.entitiesVersion + 1
            : s.entitiesVersion,
          nodeCapReached: _treeNodeCount >= TOPIC_NODE_CAP,
        });

        if (wasStructural) {
          _lastStructuralFlush = Date.now();
        }

        perfMark("rebuild-end");
        perfMeasure("rebuild", "rebuild-start", "rebuild-end");
      });
    }
  },

  reset: () => {
    // Cancel any pending scheduled rebuild
    if (_rebuildRafId !== null) {
      cancelAnimationFrame(_rebuildRafId);
      _rebuildRafId = null;
      _rebuildScheduled = false;
      _rebuildStructural = false;
    }
    // Cancel any pending burst throttle timer
    if (_burstThrottleId !== null) {
      clearTimeout(_burstThrottleId);
      _burstThrottleId = null;
    }
    // Cancel burst active indicator timer
    if (_burstActiveTimeoutId !== null) {
      clearTimeout(_burstActiveTimeoutId);
      _burstActiveTimeoutId = null;
    }
    _burstWindowStart = 0;
    _lastStructuralFlush = 0;
    // Revoke all image blob URLs to prevent memory leaks on reset
    revokeAllBlobUrls(get().root);
    _payloadLru.clear();
    _pendingMessages = 0;
    _pendingNewTopics = 0;
    // Clear analyzer state (pending debounces, fingerprints, worker-held maps)
    payloadAnalyzer.reset();
    get().sparkplugDevices.clear();
    _sparkplugDirty = false;
    _lastSparkplugVersionBump = 0;
    _sparkplugCapWarned = false;
    _treeNodeCount = 0;
    _sparkplugHistoryDevice = null;
    _sparkplugHistory.clear();
    clearEntityRegistry(_entityRegistry);
    _homieState = createHomieState();
    _recentMessages = [];
    _entitiesDirty = false;
    // Preserve user's saved visual settings across resets (e.g. on reconnect).
    // reset() clears topic tree data but must not discard localStorage settings.
    const savedForReset = loadSavedSettings();
    set({
      root: createTopicNode("", ""),
      graphNodes: [],
      graphLinks: [],
      totalMessages: 0,
      totalTopics: 0,
      sessionStart: Date.now(),
      errorMessage: null,
      graphStructureVersion: 0,
      sparkplugVersion: 0,
      entitiesVersion: 0,
      nodeCapReached: false,
      nodeScale: savedForReset.nodeScale ?? cfg.nodeScale ?? 1.0,
      scaleNodeSizeByDepth: savedForReset.scaleNodeSizeByDepth ?? cfg.scaleNodeSizeByDepth ?? true,
      selectedNodeId: null,
      highlightedNodes: new Map<string, string>(),
      burstWindowActive: false,
      burstSettingsLocked: false,
    });
  },

  resetSettings: () => {
    const tooltipsWillDisable = !(cfg.showTooltips ?? true);
    // If tooltips are being turned off, clear payload LRU (matches setShowTooltips behaviour)
    if (tooltipsWillDisable && get().showTooltips) {
      const root = get().root;
      for (const nodeId of _payloadLru) {
        const segments = nodeId === "" ? [] : nodeId.split("/");
        const node = findNode(root, segments);
        if (node) node.lastPayload = null;
      }
      _payloadLru.clear();
    }
    set({
      emaTau: cfg.emaTau ?? DEFAULT_EMA_TAU,
      showLabels: cfg.showLabels ?? true,
      labelDepthFactor: cfg.labelDepthFactor ?? 2,
      labelMode: (cfg.labelMode === "depth" || cfg.labelMode === "zoom" ? cfg.labelMode : "activity") as LabelMode,
      labelFontSize: cfg.labelFontSize ?? 15,
      labelStrokeWidth: cfg.labelStrokeWidth ?? 9.0,
      scaleTextByDepth: cfg.scaleTextByDepth ?? true,
      showTooltips: cfg.showTooltips ?? true,
      clearOnDisconnect: cfg.clearOnDisconnect ?? true,
      nodeScale: cfg.nodeScale ?? 2.5,
      scaleNodeSizeByDepth: cfg.scaleNodeSizeByDepth ?? true,
      repulsionStrength: cfg.repulsionStrength ?? -350,
      linkDistance: cfg.linkDistance ?? 155,
      linkStrength: cfg.linkStrength ?? 0.3,
      collisionPadding: cfg.collisionPadding ?? 13,
      alphaDecay: cfg.alphaDecay ?? 0.01,
      pruneTimeout: cfg.pruneTimeout ?? 0,
      dropRetainedBurst: cfg.dropRetainedBurst ?? true,
      burstWindowDuration: cfg.burstWindowDuration ?? 5_000,
      showGeoIndicators: cfg.showGeoIndicators ?? true,
      showImageIndicators: cfg.showImageIndicators ?? true,
      showSparkplugIndicators: cfg.showSparkplugIndicators ?? true,
      showHomeAssistantIndicators: cfg.showHomeAssistantIndicators ?? true,
      showFrigateIndicators: cfg.showFrigateIndicators ?? true,
      showShellyIndicators: cfg.showShellyIndicators ?? true,
      showOwnTracksIndicators: cfg.showOwnTracksIndicators ?? true,
      showTtnIndicators: cfg.showTtnIndicators ?? true,
      showChirpstackIndicators: cfg.showChirpstackIndicators ?? true,
      showHomieIndicators: cfg.showHomieIndicators ?? true,
      showOpenDtuIndicators: cfg.showOpenDtuIndicators ?? true,
      showTasmotaIndicators: cfg.showTasmotaIndicators ?? true,
      fadeIndicatorRings: cfg.fadeIndicatorRings ?? true,
      followEcosystemTopics: cfg.followEcosystemTopics ?? true,
      ancestorPulse: cfg.ancestorPulse ?? true,
      showRootPath: cfg.showRootPath ?? false,
    });
    // Clear localStorage overrides so the reset truly returns to config.json defaults.
    clearSavedSettings();
    // Rebuild graph for nodeScale and showRootPath side effects
    get().rebuildGraph();
  },

  setEmaTau: (tau: number) => {
    set({ emaTau: tau });
    persistSettings({ emaTau: tau });
  },

  setShowLabels: (show: boolean) => {
    set({ showLabels: show });
    persistSettings({ showLabels: show });
  },
  setLabelDepthFactor: (factor: number) => {
    set({ labelDepthFactor: factor });
    persistSettings({ labelDepthFactor: factor });
  },
  setLabelMode: (mode: LabelMode) => {
    set({ labelMode: mode });
    persistSettings({ labelMode: mode });
  },
  setLabelFontSize: (size: number) => {
    set({ labelFontSize: size });
    persistSettings({ labelFontSize: size });
  },
  setLabelStrokeWidth: (width: number) => {
    set({ labelStrokeWidth: width });
    persistSettings({ labelStrokeWidth: width });
  },
  setScaleTextByDepth: (enabled: boolean) => {
    set({ scaleTextByDepth: enabled });
    persistSettings({ scaleTextByDepth: enabled });
  },
  setShowTooltips: (show: boolean) => {
    set({ showTooltips: show });
    persistSettings({ showTooltips: show });
    // When disabling tooltips, clear all stored payloads to free memory
    if (!show) {
      const root = get().root;
      for (const nodeId of _payloadLru) {
        const segments = nodeId === "" ? [] : nodeId.split("/");
        const node = findNode(root, segments);
        if (node) node.lastPayload = null;
      }
      _payloadLru.clear();
    }
  },
  setClearOnDisconnect: (clear: boolean) => {
    set({ clearOnDisconnect: clear });
    persistSettings({ clearOnDisconnect: clear });
  },

  setNodeScale: (scale: number) => {
    set({ nodeScale: scale });
    persistSettings({ nodeScale: scale });
    // Rebuild graph so node radii update immediately
    get().rebuildGraph();
  },
  setFadeIndicatorRings: (enabled: boolean) => {
    set({ fadeIndicatorRings: enabled });
    persistSettings({ fadeIndicatorRings: enabled });
  },
  setScaleNodeSizeByDepth: (enabled: boolean) => {
    set({ scaleNodeSizeByDepth: enabled });
    persistSettings({ scaleNodeSizeByDepth: enabled });
  },

  setRepulsionStrength: (value: number) => {
    set({ repulsionStrength: value });
    persistSettings({ repulsionStrength: value });
  },
  setLinkDistance: (value: number) => {
    set({ linkDistance: value });
    persistSettings({ linkDistance: value });
  },
  shakeLayout: () => {
    if (get().isShaking) return;
    set({ isShaking: true });
    // Endpoints of the slider ranges (settingsStorage validators):
    // repulsion [-500,-20], linkDistance [20,300]. "Full" = strongest
    // repulsion + longest links (fling apart); "min" = collapse together.
    const FULL: [number, number] = [-500, 300];
    const MIN: [number, number] = [-20, 20];
    const MID: [number, number] = [-260, 160]; // midpoint of each range
    const seq: [number, number][] = [FULL, MIN, FULL, MIN, MID];
    const DWELL_MS = 550;
    seq.forEach(([repulsionStrength, linkDistance], i) => {
      setTimeout(() => {
        // Drives the TopicGraph effects -> GraphRenderer reheat (alpha 0.3).
        // Intermediate steps are not persisted; only the final resting MID is.
        set({ repulsionStrength, linkDistance });
        if (i === seq.length - 1) {
          persistSettings({ repulsionStrength, linkDistance });
          set({ isShaking: false });
        }
      }, i * DWELL_MS);
    });
  },
  setLinkStrength: (value: number) => {
    set({ linkStrength: value });
    persistSettings({ linkStrength: value });
  },
  setCollisionPadding: (value: number) => {
    set({ collisionPadding: value });
    persistSettings({ collisionPadding: value });
  },
  setAlphaDecay: (value: number) => {
    set({ alphaDecay: value });
    persistSettings({ alphaDecay: value });
  },
  setPruneTimeout: (value: number) => {
    set({ pruneTimeout: value });
    persistSettings({ pruneTimeout: value });
  },
  setDropRetainedBurst: (enabled: boolean) => {
    set({ dropRetainedBurst: enabled });
    persistSettings({ dropRetainedBurst: enabled });
  },
  setFollowEcosystemTopics: (enabled: boolean) => {
    set({ followEcosystemTopics: enabled });
    persistSettings({ followEcosystemTopics: enabled });
  },
  setBurstWindowDuration: (value: number) => {
    set({ burstWindowDuration: value });
    persistSettings({ burstWindowDuration: value });
  },
  setIndicatorEnabled: (key: IndicatorSettingsKey, enabled: boolean) => {
    set({ [key]: enabled });
    persistSettings({ [key]: enabled });
  },
  setAncestorPulse: (enabled: boolean) => {
    set({ ancestorPulse: enabled });
    persistSettings({ ancestorPulse: enabled });
  },
  setShowRootPath: (enabled: boolean) => {
    set({ showRootPath: enabled });
    persistSettings({ showRootPath: enabled });
    // Rebuild graph immediately so the change is visible
    get().rebuildGraph();
  },
  setTopicFilter: (filter: string) => {
    set({ topicFilter: filter });
  },
  requestExport: () => {
    set({ exportRequested: get().exportRequested + 1 });
  },
  setSelectedNodeId: (id: string | null) => {
    set({ selectedNodeId: id });
  },
  setDisplayMode: (mode: DisplayMode) => {
    set({ displayMode: mode });
  },
  requestCenterOnNode: (id: string) => {
    set((s) => ({ centerNodeId: id, centerNodeNonce: s.centerNodeNonce + 1 }));
  },
  requestFitView: (durationMs: number) => {
    set((s) => ({ fitViewDuration: durationMs, fitViewNonce: s.fitViewNonce + 1 }));
  },
  setHighlightedNodes: (nodes: Map<string, string>) => {
    // Enforce cap: keep only the first MAX_HIGHLIGHTED_NODES entries
    let capped = nodes;
    if (nodes.size > MAX_HIGHLIGHTED_NODES) {
      capped = new Map<string, string>();
      let count = 0;
      for (const [id, color] of nodes) {
        if (count >= MAX_HIGHLIGHTED_NODES) break;
        capped.set(id, color);
        count++;
      }
    }
    set({ highlightedNodes: capped });
  },
  clearHighlights: () => {
    set({ highlightedNodes: new Map<string, string>() });
  },
  setPayloadTags: (nodeId: string, tags: DetectorResult[]) => {
    const root = get().root;
    const segments = nodeId === "" ? [] : nodeId.split("/");
    const node = findNode(root, segments);
    if (node) {
      // Sparkplug tags arrive from the worker carrying full decoded metrics.
      // Strip those into the device state slice (the authoritative store)
      // and keep only the slim metadata on the node. Registry-backed
      // ecosystem tags (HA discovery, Shelly announces) likewise carry
      // parsed declarations — stripped into the entity registry the same way.
      const processed = tags.map((t) => {
        if (t.tag === "homeassistant" || t.tag === "shelly") {
          const meta = t.metadata as EntityTagMetadata;
          if (meta.declarations && meta.declarations.length > 0) {
            // Apply declarations + follow uncovered declared topics (shared with
            // the registry-only burst ingest).
            if (applyDeclarationsAndFollow(meta.declarations, get())) {
              _entitiesDirty = true;
            }
          }
          const entity = _entityRegistry.entities.get(meta.entityKey);
          const slim: EntityTagMetadata = {
            entityKey: meta.entityKey,
            role: meta.role,
            label: meta.label,
            // The registry is authoritative for online state.
            online: entity?.online ?? meta.online,
          };
          return { ...t, metadata: slim } as DetectorResult;
        }
        if (t.tag !== "sparkplug") return t;
        const meta = t.metadata as SparkplugMetadata;
        const devices = get().sparkplugDevices;
        const device = devices.get(meta.deviceKey);
        if (device && meta.metrics) {
          const decoded = {
            timestamp: meta.payloadTimestamp ?? null,
            seq: meta.seq ?? null,
            metrics: meta.metrics,
          };
          applySparkplugMetrics(device, decoded);
          // Sparkline history — recorded only for the device whose panel is open
          if (meta.deviceKey === _sparkplugHistoryDevice) {
            appendMetricHistory(_sparkplugHistory, decoded, Date.now());
          }
          // seq is a per-EDGE counter shared across node and device messages,
          // so it tracks on the edge entry (fall back to the device entry
          // when no edge-level message has been seen yet).
          const edgeEntry = devices.get(`${device.groupId}/${device.edgeNodeId}`) ?? device;
          applySparkplugSeq(edgeEntry, meta.seq ?? null);
          // Batched — drained by the rAF flush (scheduleRebuild below).
          _sparkplugDirty = true;
        }
        const slim: SparkplugMetadata = {
          deviceKey: meta.deviceKey,
          role: meta.role,
          messageType: meta.messageType,
          // The store slice is authoritative for online state — the worker
          // result may be stale (it lags lifecycle by the debounce window).
          online: device?.online ?? meta.online,
          metricCount: device?.metrics.size ?? meta.metricCount,
        };
        return { ...t, metadata: slim } as DetectorResult;
      });

      // Merge new tags with existing tags: new tags replace existing tags of
      // the same type, while existing tags of types not present in the new
      // results are preserved.  This prevents e.g. an image analysis result
      // from wiping a previously detected geo tag (and vice versa).
      const newTagTypes = new Set(processed.map((t) => t.tag));
      const preserved = node.payloadTags?.filter((t) => !newTagTypes.has(t.tag)) ?? [];
      node.payloadTags = [...preserved, ...processed];
      // Schedule a non-structural rebuild so graphNodes picks up the new tags
      // and React re-renders components that depend on payloadTags.
      get().scheduleRebuild(false);
    }
  },
};});

// Wire up the payload analyzer worker callback to the store.
// When the worker finishes analyzing a payload, it posts results here.
payloadAnalyzer.onResult((nodeId, tags) => {
  useTopicStore.getState().setPayloadTags(nodeId, tags);
});

/** Start the periodic decay timer. Returns a cleanup function. */
export function startDecayTimer(): () => void {
  const interval = setInterval(() => {
    useTopicStore.getState().decayTick();
  }, DECAY_INTERVAL);

  return () => clearInterval(interval);
}
