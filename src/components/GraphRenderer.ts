import * as d3 from "d3";
import type { GraphNode, GraphLink, Particle, LabelMode, TooltipData } from "../types";
import { rateToColor, pulseColor, IDLE_STROKE } from "../utils/colorScale";
import { depthScale } from "../utils/formatters";
import {
  PERF_ENABLED,
  perfMark,
  perfMeasure,
  perfStats,
  RollingAvg,
  getHeapMB,
  logPerfSummary,
  initPerfObserver,
} from "../utils/perfDebug";

/** Maximum number of particles alive at once. */
const MAX_PARTICLES = 500;

/** Number of particles spawned per message pulse. */
const PARTICLES_PER_PULSE = 6;

/** Default base font size for labels in pixels (at zoom scale 1.0). */
const DEFAULT_BASE_FONT_SIZE = 14;

/** Default label depth factor. Higher = more labels visible when zoomed out. */
const DEFAULT_LABEL_DEPTH_FACTOR = 5;

/**
 * GraphRenderer manages a D3 force simulation and renders it into an SVG element.
 * It handles nodes, links, labels, glow effects, particle bursts, and heat-map colouring.
 */
export class GraphRenderer {
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private container!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private simulation!: d3.Simulation<GraphNode, GraphLink>;
  private nodeElements!: d3.Selection<SVGCircleElement, GraphNode, SVGGElement, unknown>;
  private linkElements!: d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown>;
  private labelElements!: d3.Selection<SVGTextElement, GraphNode, SVGGElement, unknown>;
  private defs!: d3.Selection<SVGDefsElement, unknown, null, undefined>;

  private linkGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private highlightRingGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private nodeGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private labelGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private particleGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;

  private particles: Particle[] = [];
  private animationFrame: number | null = null;
  private width = 0;
  private height = 0;
  private currentZoomScale = 1;
  private labelDepthFactor = DEFAULT_LABEL_DEPTH_FACTOR;
  private labelMode: LabelMode = "zoom";
  private showLabels = true;
  private baseFontSize = DEFAULT_BASE_FONT_SIZE;
  private scaleTextByDepth = false;
  private scaleNodeSizeByDepth = false;
  private collisionPadding = 4;
  private fadeDuration = 5000;

  // Track which nodes have been pulsed to avoid re-triggering
  private lastPulseTimestamps = new Map<string, number>();

  // Callback invoked when a node is hovered/unhovered — bridges D3 → React.
  private onTooltip: ((data: TooltipData | null) => void) | null = null;
  private showTooltips = true;
  private tooltipDelayTimer: ReturnType<typeof setTimeout> | null = null;

  // Set of node IDs that are currently fading (need per-frame colour updates).
  // Nodes are added when they pulse and removed when their fade completes.
  private activeNodeIds = new Set<string>();
  // Same for links — keyed by "sourceId-targetId"
  private activeLinkKeys = new Set<string>();

  // Highlight ring elements — one <circle> per highlighted node.
  private highlightRingElements!: d3.Selection<SVGCircleElement, { id: string; color: string }, SVGGElement, unknown>;
  // Map of nodeId → colour hex for externally highlighted nodes.
  private highlightedNodes: Map<string, string> = new Map();

  // Selection state — the currently selected/pinned node ID.
  private selectedNodeId: string | null = null;

  // Callback invoked when a node is clicked (D3 → React bridge).
  private onNodeClick: ((nodeId: string) => void) | null = null;
  // Callback invoked when the SVG background is clicked (deselect).
  private onBackgroundClick: (() => void) | null = null;

  // --- Perf debug fields (only used when PERF_ENABLED) ---
  private perfFrameCount = 0;
  private perfLastSummaryTime = 0;
  private perfLastFpsTime = 0;
  private perfFps = 0;
  private perfFrameAvg = PERF_ENABLED ? new RollingAvg(60) : null;
  private perfTickAvg = PERF_ENABLED ? new RollingAvg(60) : null;
  private perfNodeColorAvg = PERF_ENABLED ? new RollingAvg(60) : null;

  constructor(svgElement: SVGSVGElement) {
    this.svg = d3.select(svgElement);
    this.width = svgElement.clientWidth;
    this.height = svgElement.clientHeight;

    this.setupSvg();
    this.setupSimulation();
    this.startAnimationLoop();
  }

  private setupSvg(): void {
    this.svg.selectAll("*").remove();

    // Define SVG filters for glow effect
    this.defs = this.svg.append("defs");

    const glowFilter = this.defs
      .append("filter")
      .attr("id", "glow")
      .attr("x", "-50%")
      .attr("y", "-50%")
      .attr("width", "200%")
      .attr("height", "200%");

    glowFilter
      .append("feGaussianBlur")
      .attr("stdDeviation", "4")
      .attr("result", "blur");

    glowFilter
      .append("feComposite")
      .attr("in", "SourceGraphic")
      .attr("in2", "blur")
      .attr("operator", "over");

    // Zoom & pan container
    this.container = this.svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .on("zoom", (event) => {
        this.currentZoomScale = event.transform.k;
        this.container.attr("transform", event.transform);
        this.updateLabelVisibility();
      });

    this.svg.call(zoom);

    // Background click: deselect when clicking empty space.
    // Use mousedown + check target to distinguish from drags and node clicks.
    this.svg.on("click", (event: MouseEvent) => {
      // Only fire if the click target is the SVG itself or the container <g>,
      // not a child element (node/link/label).
      if (event.target === this.svg.node() || event.target === this.container.node()) {
        this.onBackgroundClick?.();
      }
    });

    // Layer ordering: links → highlight rings → nodes → particles → labels
    // Highlight rings sit below node circles so the selection ring (on the node itself)
    // is always visually on top.
    this.linkGroup = this.container.append("g").attr("class", "links");
    this.highlightRingGroup = this.container.append("g").attr("class", "highlight-rings");
    this.nodeGroup = this.container.append("g").attr("class", "nodes");
    this.particleGroup = this.container.append("g").attr("class", "particles");
    this.labelGroup = this.container.append("g").attr("class", "labels");

    // Initialize empty selections
    this.linkElements = this.linkGroup.selectAll<SVGLineElement, GraphLink>("line");
    this.highlightRingElements = this.highlightRingGroup.selectAll<SVGCircleElement, { id: string; color: string }>("circle");
    this.nodeElements = this.nodeGroup.selectAll<SVGCircleElement, GraphNode>("circle");
    this.labelElements = this.labelGroup.selectAll<SVGTextElement, GraphNode>("text");
  }

  private setupSimulation(): void {
    this.simulation = d3
      .forceSimulation<GraphNode, GraphLink>()
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>()
          .id((d) => d.id)
          .distance(80)
          .strength(0.5)
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(this.width / 2, this.height / 2))
      .force(
        "collide",
        d3.forceCollide<GraphNode>().radius((d) => d.displayRadius + this.collisionPadding)
      )
      .alphaDecay(0.01)
      .on("tick", () => this.tick());
  }

  /**
   * Full structural update — performs D3 data join for nodes/links/labels.
   * Call this when nodes are added or removed.
   */
  update(nodes: GraphNode[], links: GraphLink[]): void {
    // Preserve existing node positions
    const oldState = new Map<string, { x: number; y: number; vx: number; vy: number; displayRadius: number }>();
    this.simulation.nodes().forEach((n) => {
      if (n.x !== undefined && n.y !== undefined) {
        oldState.set(n.id, {
          x: n.x,
          y: n.y,
          vx: n.vx ?? 0,
          vy: n.vy ?? 0,
          displayRadius: n.displayRadius,
        });
      }
    });

    // Apply preserved positions and displayRadius to existing nodes
    for (const node of nodes) {
      const old = oldState.get(node.id);
      if (old) {
        node.x = old.x;
        node.y = old.y;
        node.vx = old.vx;
        node.vy = old.vy;
        node.displayRadius = old.displayRadius;
      } else {
        // New nodes: place near center with some jitter
        node.x = this.width / 2 + (Math.random() - 0.5) * 100;
        node.y = this.height / 2 + (Math.random() - 0.5) * 100;
      }
    }

    // Update simulation data
    this.simulation.nodes(nodes);
    (this.simulation.force("link") as d3.ForceLink<GraphNode, GraphLink>).links(links);

    // Update collide force with current displayed radii
    (this.simulation.force("collide") as d3.ForceCollide<GraphNode>).radius(
      (d) => d.displayRadius + this.collisionPadding
    );

    // Check for new pulses and spawn particles
    this.checkPulses(nodes);
    this.checkLinkPulses(links);

    // --- Update links ---
    this.linkElements = this.linkGroup
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(links, (d) => `${(d.source as GraphNode).id ?? d.source}-${(d.target as GraphNode).id ?? d.target}`);

    this.linkElements.exit().remove();

    this.linkElements = this.linkElements
      .enter()
      .append("line")
      .attr("stroke", "#6b7280")
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.8)
      .merge(this.linkElements);

    // --- Update nodes ---
    this.nodeElements = this.nodeGroup
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(nodes, (d) => d.id);

    this.nodeElements.exit().remove();

    const enterSelection = this.nodeElements
      .enter()
      .append("circle")
      .attr("stroke-width", 2)
      .call(this.setupDrag());

    // Capture enter count before merge — used for burst-aware reheat below.
    const enterCount = enterSelection.size();

    this.nodeElements = enterSelection.merge(this.nodeElements);

    // Initialise displayRadius for new nodes; existing nodes keep their current displayRadius.
    // The animation loop will smoothly lerp displayRadius toward radius.
    this.nodeElements
      .attr("r", (d) => d.displayRadius)
      .attr("stroke-width", (d) => (d.depth === 0 ? 2.5 : 2));

    // Attach hover events for tooltip (idempotent on merged selection)
    this.nodeElements
      .on("mouseenter", (_event: MouseEvent, d: GraphNode) => {
        if (!this.onTooltip || !this.showTooltips) return;
        // Clear any pending delay from a previous hover
        if (this.tooltipDelayTimer !== null) {
          clearTimeout(this.tooltipDelayTimer);
        }
        // Delay 500ms before showing the tooltip
        this.tooltipDelayTimer = setTimeout(() => {
          this.tooltipDelayTimer = null;
          const containerCTM = this.container.node()?.getScreenCTM();
          if (!containerCTM) return;
          const screenX = (d.x ?? 0) * containerCTM.a + containerCTM.e;
          const screenY = (d.y ?? 0) * containerCTM.d + containerCTM.f;
          this.onTooltip?.({ nodeId: d.id, screenX, screenY });
        }, 500);
      })
      .on("mouseleave", () => {
        if (this.tooltipDelayTimer !== null) {
          clearTimeout(this.tooltipDelayTimer);
          this.tooltipDelayTimer = null;
        }
        this.onTooltip?.(null);
      });

    // --- Update labels ---
    this.labelElements = this.labelGroup
      .selectAll<SVGTextElement, GraphNode>("text")
      .data(nodes, (d) => d.id);

    this.labelElements.exit().remove();

    this.labelElements = this.labelElements
      .enter()
      .append("text")
      .attr("text-anchor", "middle")
      .attr("fill", "#e2e8f0")
      .attr("font-size", `${this.baseFontSize}px`)
      .attr("font-family", "monospace")
      .attr("pointer-events", "none")
      .merge(this.labelElements)
      .text((d) => d.label);

    // Reapply depth-based label visibility for newly entered labels
    this.updateLabelVisibility();

    // Burst-aware simulation reheat.
    // During an initial connection burst, hundreds of nodes enter across many consecutive
    // update() calls. Using a full alpha(0.3) on every call keeps reheating the simulation
    // before it can settle, causing continuous jitter and high d3TickMs.
    //
    // If more than BURST_ENTER_THRESHOLD new nodes entered this update, use a low alpha
    // so the simulation moves gently without destabilising existing nodes. Once a normal
    // (small) update arrives, restore the full alpha to let the layout settle properly.
    const BURST_ENTER_THRESHOLD = 50;
    if (enterCount > BURST_ENTER_THRESHOLD) {
      // Burst: nudge gently — don't destabilise nodes that are already positioned
      this.simulation.alpha(0.05).restart();
    } else {
      // Normal update: full reheat so new nodes find their place
      this.simulation.alpha(0.3).restart();
    }
  }

  /**
   * Lightweight data-only update — syncs rate/pulse/radius data onto existing
   * D3-bound nodes and links WITHOUT performing a data join (no enter/exit).
   * Call this when only rates/pulses changed but no nodes were added or removed.
   * The animation loop will pick up the new values on the next frame.
   */
  updateData(nodes: GraphNode[], links: GraphLink[]): void {
    // Build a lookup map for O(1) access
    const nodeMap = new Map<string, GraphNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    // Update bound data on existing D3 node elements in-place.
    // Keep displayRadius unchanged — the animation loop will smoothly lerp it.
    this.simulation.nodes().forEach((simNode) => {
      const fresh = nodeMap.get(simNode.id);
      if (fresh) {
        simNode.messageRate = fresh.messageRate;
        simNode.aggregateRate = fresh.aggregateRate;
        simNode.pulse = fresh.pulse;
        simNode.pulseTimestamp = fresh.pulseTimestamp;
        simNode.pulseRate = fresh.pulseRate;
        simNode.radius = fresh.radius;
        // displayRadius is NOT updated here — the animation loop lerps it
      }
    });

    // Update link pulse data in-place
    const linkKey = (l: GraphLink) => {
      const src = typeof l.source === "string" ? l.source : (l.source as GraphNode).id;
      const tgt = typeof l.target === "string" ? l.target : (l.target as GraphNode).id;
      return `${src}-${tgt}`;
    };
    const linkMap = new Map<string, GraphLink>();
    for (const l of links) linkMap.set(linkKey(l), l);

    this.linkElements.each(function (d) {
      const fresh = linkMap.get(linkKey(d));
      if (fresh) {
        d.pulse = fresh.pulse;
        d.pulseTimestamp = fresh.pulseTimestamp;
      }
    });

    // Check for new pulses and spawn particles
    this.checkPulses(nodes);
    this.checkLinkPulses(links);
  }

  /** Check nodes for new pulse timestamps, spawn particles, and mark as active. */
  private checkPulses(nodes: GraphNode[]): void {
    for (const node of nodes) {
      if (node.pulse) {
        const lastPulse = this.lastPulseTimestamps.get(node.id) ?? 0;
        if (node.pulseTimestamp > lastPulse) {
          this.lastPulseTimestamps.set(node.id, node.pulseTimestamp);
          this.spawnParticles(node);
        }
        // Mark any pulsing node for per-frame colour updates
        this.activeNodeIds.add(node.id);
      }
    }
  }

  /** Mark pulsing links as active so they get per-frame colour updates. */
  private checkLinkPulses(links: GraphLink[]): void {
    for (const link of links) {
      if (link.pulse) {
        this.activeLinkKeys.add(this.linkKey(link));
      }
    }
  }

  /** Position elements on each simulation tick. */
  private tick(): void {
    perfMark("d3-tick-start");

    this.linkElements
      .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
      .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
      .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
      .attr("y2", (d) => (d.target as GraphNode).y ?? 0);

    this.nodeElements
      .attr("cx", (d) => d.x ?? 0)
      .attr("cy", (d) => d.y ?? 0);

    // Sync highlight rings with animated node positions (only when rings exist)
    if (this.highlightedNodes.size > 0) {
      this.syncHighlightRingPositions();
    }

    // Counter-scale so labels stay a constant screen size
    const baseSize = this.baseFontSize / this.currentZoomScale;
    const labelGap = 14 / this.currentZoomScale;
    const useDepthText = this.scaleTextByDepth;

    this.labelElements
      .attr("x", (d) => d.x ?? 0)
      .attr("y", (d) => (d.y ?? 0) + d.displayRadius + labelGap)
      .attr("font-size", (d) => {
        const size = useDepthText ? depthScale(baseSize, d.depth, 0.25) : baseSize;
        return `${size}px`;
      });

    perfMark("d3-tick-end");
    const dur = perfMeasure("d3-tick", "d3-tick-start", "d3-tick-end");
    this.perfTickAvg?.push(dur);
  }

  /**
   * Update label opacity based on depth vs current zoom level.
   * Deeper nodes fade out first when zoomed out.
   * Uses a 4-level fade band for smooth gradation.
   */
  private updateLabelVisibility(): void {
    if (!this.showLabels) {
      this.labelElements.attr("opacity", 0);
      return;
    }

    if (this.labelMode === "depth") {
      // Hard cutoff by tree depth — not affected by zoom level
      const maxDepth = this.labelDepthFactor;
      this.labelElements.attr("opacity", (d) => (d.depth <= maxDepth ? 1 : 0));
    } else {
      // Zoom mode: deeper labels fade out when zoomed out.
      // The +2 offset ensures shallow labels (depth 1-2) resist fading
      // much longer when zoomed out, keeping them readable.
      const maxDepth = this.currentZoomScale * this.labelDepthFactor + 2;
      const FADE_BAND = 4;
      this.labelElements.attr("opacity", (d) => {
        if (d.depth === 0) return 1; // Root label always visible
        if (d.depth >= maxDepth) return 0;
        if (d.depth <= maxDepth - FADE_BAND) return 1;
        return (maxDepth - d.depth) / FADE_BAND;
      });
    }
  }

  /** Update the label depth factor and reapply visibility. */
  setLabelDepthFactor(factor: number): void {
    this.labelDepthFactor = factor;
    this.updateLabelVisibility();
  }

  /** Update the label visibility mode and reapply visibility. */
  setLabelMode(mode: LabelMode): void {
    this.labelMode = mode;
    this.updateLabelVisibility();
  }

  /** Toggle label visibility entirely. */
  setShowLabels(show: boolean): void {
    this.showLabels = show;
    this.updateLabelVisibility();
  }

  /** Update the base font size for labels. */
  setLabelFontSize(size: number): void {
    this.baseFontSize = size;
    this.updateLabelFontSizes();
  }

  /** Toggle depth-based text scaling. */
  setScaleTextByDepth(enabled: boolean): void {
    this.scaleTextByDepth = enabled;
    this.updateLabelFontSizes();
  }

  /** Toggle depth-based node size scaling. */
  setScaleNodeSizeByDepth(enabled: boolean): void {
    this.scaleNodeSizeByDepth = enabled;
  }

  /** Register a callback for node hover tooltip events. */
  setTooltipCallback(cb: ((data: TooltipData | null) => void) | null): void {
    this.onTooltip = cb;
  }

  /** Register a callback for node click events. */
  setClickCallback(cb: ((nodeId: string) => void) | null): void {
    this.onNodeClick = cb;
  }

  /** Register a callback for background (empty space) click events. */
  setBackgroundClickCallback(cb: (() => void) | null): void {
    this.onBackgroundClick = cb;
  }

  /** Update the selected node ID. Clears the ring on the previous selection. */
  setSelectedNodeId(id: string | null): void {
    const prev = this.selectedNodeId;
    this.selectedNodeId = id;
    // Clear the visual ring on the previously selected node
    if (prev !== null && prev !== id) {
      this.clearSelectionRing(prev);
    }
  }

  /**
   * Replace the set of highlighted nodes and refresh the highlight ring D3 join.
   * Pass an empty Map to remove all highlight rings.
   */
  setHighlightedNodes(nodes: Map<string, string>): void {
    this.highlightedNodes = nodes;
    this.refreshHighlightRings();
  }

  /** Toggle whether hover tooltips are enabled. */
  setShowTooltips(show: boolean): void {
    this.showTooltips = show;
    // If disabling, clear any pending delay and dismiss the current tooltip
    if (!show) {
      if (this.tooltipDelayTimer !== null) {
        clearTimeout(this.tooltipDelayTimer);
        this.tooltipDelayTimer = null;
      }
      this.onTooltip?.(null);
    }
  }

  /** Reapply font sizes to all labels immediately (e.g. after settings change). */
  private updateLabelFontSizes(): void {
    const baseSize = this.baseFontSize / this.currentZoomScale;
    const useDepthText = this.scaleTextByDepth;
    this.labelElements.attr("font-size", (d) => {
      const size = useDepthText ? depthScale(baseSize, d.depth, 0.25) : baseSize;
      return `${size}px`;
    });
  }

  /** Update the repulsion strength between all nodes. */
  setRepulsionStrength(value: number): void {
    (this.simulation.force("charge") as d3.ForceManyBody<GraphNode>).strength(value);
    this.simulation.alpha(0.3).restart();
  }

  /** Update the ideal distance between linked parent-child nodes. */
  setLinkDistance(value: number): void {
    (this.simulation.force("link") as d3.ForceLink<GraphNode, GraphLink>).distance(value);
    this.simulation.alpha(0.3).restart();
  }

  /** Update how rigidly links enforce their ideal distance. */
  setLinkStrength(value: number): void {
    (this.simulation.force("link") as d3.ForceLink<GraphNode, GraphLink>).strength(value);
    this.simulation.alpha(0.3).restart();
  }

  /** Update the collision padding around each node. */
  setCollisionPadding(value: number): void {
    this.collisionPadding = value;
    (this.simulation.force("collide") as d3.ForceCollide<GraphNode>).radius(
      (d) => d.displayRadius + value
    );
    this.simulation.alpha(0.3).restart();
  }

  /** Update how quickly the simulation settles after changes. */
  setAlphaDecay(value: number): void {
    this.simulation.alphaDecay(value);
  }

  /** Update the fade duration for pulse effects (nodes and links). */
  setFadeDuration(ms: number): void {
    this.fadeDuration = ms;
  }

  /**
   * Update node fill, stroke, glow, and stroke-opacity per frame.
   * Only processes nodes that are currently fading (in activeNodeIds set).
   * Idle nodes are set once when their fade completes and then skipped.
   */
  private updateNodeColors(): void {
    if (this.activeNodeIds.size === 0 && this.selectedNodeId === null) return;

    perfMark("node-colors-start");
    const now = Date.now();
    const duration = this.fadeDuration;
    const toRemove: string[] = [];
    const selectedId = this.selectedNodeId;

    if (this.activeNodeIds.size > 0) {
      this.nodeElements
        .filter((d) => this.activeNodeIds.has(d.id))
        .attr("fill", (d) => {
          if (d.depth === 0) return "#ffffff";
          const age = now - d.pulseTimestamp;
          const t = Math.min(age / duration, 1);
          if (t >= 1) {
            toRemove.push(d.id);
            return rateToColor(d.messageRate);
          }
          const warmColor = rateToColor(d.pulseRate);
          const idleColor = rateToColor(d.messageRate);
          return d3.interpolateRgb(warmColor, idleColor)(t);
        })
        .attr("stroke", (d) => {
          // Selected node gets a bright ring regardless of pulse state
          if (d.id === selectedId) return "#60a5fa";
          if (d.depth === 0) return "#ffffff";
          const age = now - d.pulseTimestamp;
          const t = Math.min(age / duration, 1);
          if (t >= 1) return IDLE_STROKE;
          return d3.interpolateRgb(pulseColor(d.messageRate), IDLE_STROKE)(t);
        })
        .attr("stroke-width", (d) => {
          if (d.id === selectedId) return 3.5 / this.currentZoomScale;
          return d.depth === 0 ? 2.5 : 2;
        })
        .attr("filter", (d) => {
          if (d.depth === 0) return "none";
          const age = now - d.pulseTimestamp;
          return age < duration ? "url(#glow)" : "none";
        })
        .attr("stroke-opacity", (d) => {
          // Selected node always has full opacity stroke
          if (d.id === selectedId) return 1;
          if (d.depth === 0) return 1;
          const age = now - d.pulseTimestamp;
          const t = Math.min(age / duration, 1);
          return 1 - 0.4 * t; // 1.0 → 0.6
        });

      // Remove completed fades from the active set
      for (const id of toRemove) {
        this.activeNodeIds.delete(id);
      }
    }

    // Apply selection ring to the selected node even when it's not actively fading.
    // This ensures the ring persists after the pulse animation completes.
    if (selectedId !== null) {
      this.nodeElements
        .filter((d) => d.id === selectedId && !this.activeNodeIds.has(d.id))
        .attr("stroke", "#60a5fa")
        .attr("stroke-width", 3.5 / this.currentZoomScale)
        .attr("stroke-opacity", 1);
    }

    perfMark("node-colors-end");
    const dur = perfMeasure("node-colors", "node-colors-start", "node-colors-end");
    this.perfNodeColorAvg?.push(dur);
  }

  /**
   * Perform a D3 data join for highlight ring circles.
   * Called whenever the highlighted node set changes.
   * Positions are synced in tick() so rings track animated displayRadius.
   */
  private refreshHighlightRings(): void {
    const data = Array.from(this.highlightedNodes.entries()).map(([id, color]) => ({ id, color }));

    this.highlightRingElements = this.highlightRingGroup
      .selectAll<SVGCircleElement, { id: string; color: string }>("circle")
      .data(data, (d) => d.id);

    this.highlightRingElements.exit().remove();

    this.highlightRingElements = this.highlightRingElements
      .enter()
      .append("circle")
      .attr("fill", "none")
      .attr("stroke-opacity", 0.85)
      .attr("pointer-events", "none")
      .merge(this.highlightRingElements)
      // Update colour on both enter and update (handles colour changes)
      .attr("stroke", (d) => d.color);

    // Sync initial positions from current simulation state
    this.syncHighlightRingPositions();
  }

  /**
   * Sync highlight ring positions and sizes from the current simulation nodes.
   * Called in refreshHighlightRings() and every tick() while rings exist.
   */
  private syncHighlightRingPositions(): void {
    if (this.highlightedNodes.size === 0) return;

    // Build a lookup of simulated node positions
    const nodePositions = new Map<string, { x: number; y: number; r: number }>();
    this.simulation.nodes().forEach((n) => {
      nodePositions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, r: n.displayRadius });
    });

    // Counter-scale stroke-width so the ring stays visually consistent at any zoom level.
    // 1.5px at zoom 1.0 → thicker when zoomed in, thinner when zoomed out, always readable.
    const ringStrokeWidth = 1.5 / this.currentZoomScale;

    this.highlightRingElements
      .attr("cx", (d) => nodePositions.get(d.id)?.x ?? 0)
      .attr("cy", (d) => nodePositions.get(d.id)?.y ?? 0)
      .attr("r", (d) => (nodePositions.get(d.id)?.r ?? 0) + 4 / this.currentZoomScale)
      .attr("stroke-width", ringStrokeWidth);
  }

  /**
   * Reapply default stroke styles to the previously selected node
   * when selection changes. Called internally by setSelectedNodeId().
   */
  private clearSelectionRing(prevId: string): void {
    this.nodeElements
      .filter((d) => d.id === prevId)
      .attr("stroke", (d) => {
        if (d.depth === 0) return "#ffffff";
        return IDLE_STROKE;
      })
      .attr("stroke-width", (d) => (d.depth === 0 ? 2.5 : 2))
      .attr("stroke-opacity", (d) => (d.depth === 0 ? 1 : 0.6));
  }

  /** Create a drag behaviour for nodes. */
  private setupDrag(): d3.DragBehavior<SVGCircleElement, GraphNode, GraphNode | d3.SubjectPosition> {
    return d3
      .drag<SVGCircleElement, GraphNode>()
      .on("start", (event, d) => {
        if (!event.active) this.simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) this.simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;

        // Detect click: drag ended at exactly the starting position
        if (event.dx === 0 && event.dy === 0) {
          this.onNodeClick?.(d.id);
        }
      });
  }

  /** Spawn a particle burst at the given node's position. */
  private spawnParticles(node: GraphNode): void {
    if (node.x === undefined || node.y === undefined) return;

    const color = pulseColor(node.messageRate);
    for (let i = 0; i < PARTICLES_PER_PULSE; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;

      const angle = (Math.PI * 2 * i) / PARTICLES_PER_PULSE + (Math.random() - 0.5) * 0.5;
      const speed = 1 + Math.random() * 2;

      this.particles.push({
        x: node.x,
        y: node.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        maxLife: 1,
        radius: 2 + Math.random() * 2,
        color,
      });
    }
  }

  /**
   * Smoothly interpolate displayRadius toward target radius for all nodes.
   * Uses an exponential lerp — each frame moves ~12% of the remaining distance.
   * At 60fps this gives a smooth ~150ms transition feel.
   */
  private updateNodeSizes(): void {
    const LERP_FACTOR = 0.12;
    const SNAP_THRESHOLD = 0.3; // snap when within 0.3px to avoid endless micro-updates
    const scaleByDepth = this.scaleNodeSizeByDepth;
    let anyChanged = false;

    this.simulation.nodes().forEach((d) => {
      // Target radius: apply depth scaling if enabled (visual only, not collision)
      const target = scaleByDepth ? depthScale(d.radius, d.depth) : d.radius;
      const diff = target - d.displayRadius;
      if (Math.abs(diff) < SNAP_THRESHOLD) {
        if (d.displayRadius !== target) {
          d.displayRadius = target;
          anyChanged = true;
        }
        return;
      }
      d.displayRadius += diff * LERP_FACTOR;
      anyChanged = true;
    });

    if (anyChanged) {
      this.nodeElements.attr("r", (d) => d.displayRadius);

      // Keep collision force in sync with displayed size
      (this.simulation.force("collide") as d3.ForceCollide<GraphNode>).radius(
        (d) => d.displayRadius + this.collisionPadding
      );
    }
  }

  /** Animation loop for particles, node colours, link colours, and smooth sizing. */
  private startAnimationLoop(): void {
    // Initialise perf observer once (long-animation-frame / longtask detection)
    if (PERF_ENABLED) {
      initPerfObserver();
      this.perfLastFpsTime = performance.now();
      this.perfLastSummaryTime = performance.now();
    }

    const animate = (timestamp: DOMHighResTimeStamp) => {
      // --- FPS counting ---
      if (PERF_ENABLED) {
        perfMark("frame-start");
        this.perfFrameCount++;

        const fpsDelta = timestamp - this.perfLastFpsTime;
        if (fpsDelta >= 1000) {
          this.perfFps = Math.round((this.perfFrameCount * 1000) / fpsDelta);
          this.perfFrameCount = 0;
          this.perfLastFpsTime = timestamp;
        }
      }

      this.updateParticles();
      this.renderParticles();
      this.updateNodeSizes();
      this.updateNodeColors();
      this.updateLinkColors();
      // Sync highlight ring radii with lerped displayRadius each frame
      if (this.highlightedNodes.size > 0) {
        this.syncHighlightRingPositions();
      }

      // --- Frame measurement + periodic summary ---
      if (PERF_ENABLED) {
        perfMark("frame-end");
        const frameDur = perfMeasure("frame", "frame-start", "frame-end");
        this.perfFrameAvg?.push(frameDur);

        // Log summary every 5 seconds
        const summaryDelta = timestamp - this.perfLastSummaryTime;
        if (summaryDelta >= 5000) {
          this.perfLastSummaryTime = timestamp;
          const nodes = this.simulation.nodes();
          logPerfSummary({
            fps: this.perfFps,
            frameMs: +(this.perfFrameAvg?.avg() ?? 0).toFixed(2),
            d3TickMs: +(this.perfTickAvg?.avg() ?? 0).toFixed(2),
            nodeColorMs: +(this.perfNodeColorAvg?.avg() ?? 0).toFixed(2),
            decayTickMs: +perfStats.lastDecayTickMs.toFixed(2),
            nodeCount: nodes.length,
            linkCount: (this.simulation.force("link") as d3.ForceLink<GraphNode, GraphLink>)?.links().length ?? 0,
            activeNodes: this.activeNodeIds.size,
            particles: this.particles.length,
            heapMB: getHeapMB(),
          });
        }
      }

      this.animationFrame = requestAnimationFrame(animate);
    };
    this.animationFrame = requestAnimationFrame(animate);
  }


  /** Update particle positions and lifetimes. Uses swap-and-pop to avoid O(n) splice. */
  private updateParticles(): void {
    let i = 0;
    while (i < this.particles.length) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.98; // friction
      p.vy *= 0.98;
      p.life -= 0.02;

      if (p.life <= 0) {
        // Swap with last element and pop — O(1) removal
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        // Don't increment i — we need to process the swapped element
      } else {
        i++;
      }
    }
  }

  /** Render particles as SVG circles using direct DOM manipulation. */
  private renderParticles(): void {
    const group = this.particleGroup.node();
    if (!group) return;

    // Remove excess SVG elements
    while (group.childNodes.length > this.particles.length) {
      group.removeChild(group.lastChild!);
    }

    // Add missing SVG elements
    while (group.childNodes.length < this.particles.length) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      group.appendChild(circle);
    }

    // Update all particle attributes directly (no D3 data join overhead)
    const children = group.childNodes;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const el = children[i] as SVGCircleElement;
      el.setAttribute("cx", String(p.x));
      el.setAttribute("cy", String(p.y));
      el.setAttribute("r", String(p.radius * p.life));
      el.setAttribute("fill", p.color);
      el.setAttribute("opacity", String(p.life * 0.8));
    }
  }

  /** Update link colours based on pulse state — fades from white to grey. */
  private updateLinkColors(): void {
    if (this.activeLinkKeys.size === 0) return;

    const now = Date.now();
    const duration = this.fadeDuration;
    const IDLE_LINK_COLOR = "#6b7280";
    const toRemove: string[] = [];

    this.linkElements
      .filter((d) => {
        const key = this.linkKey(d);
        return this.activeLinkKeys.has(key);
      })
      .attr("stroke", (d) => {
        if (!d.pulse) {
          toRemove.push(this.linkKey(d));
          return IDLE_LINK_COLOR;
        }
        const age = now - (d.pulseTimestamp ?? 0);
        const t = Math.min(age / duration, 1);
        if (t >= 1) {
          toRemove.push(this.linkKey(d));
          return IDLE_LINK_COLOR;
        }
        return d3.interpolateRgb("#ffffff", IDLE_LINK_COLOR)(t);
      })
      .attr("stroke-opacity", (d) => {
        if (!d.pulse) return 0.8;
        const age = now - (d.pulseTimestamp ?? 0);
        const t = Math.min(age / duration, 1);
        return 1 - 0.2 * t; // 1.0 → 0.8
      });

    for (const key of toRemove) {
      this.activeLinkKeys.delete(key);
    }
  }

  /** Generate a stable key for a link (works whether source/target are strings or objects). */
  private linkKey(d: GraphLink): string {
    const src = typeof d.source === "string" ? d.source : (d.source as GraphNode).id;
    const tgt = typeof d.target === "string" ? d.target : (d.target as GraphNode).id;
    return `${src}-${tgt}`;
  }

  /** Handle container resize. */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    (this.simulation.force("center") as d3.ForceCenter<GraphNode>)
      .x(width / 2)
      .y(height / 2);
    this.simulation.alpha(0.1).restart();
  }

  /** Export the full graph as a PNG image and trigger a download. */
  async exportPng(): Promise<void> {
    const nodes = this.simulation.nodes();
    if (nodes.length === 0) return;

    // Compute bounding box of all nodes (accounting for radius + label space)
    const LABEL_PAD = 30; // extra space for labels below nodes
    const PADDING = 40;   // margin around the graph
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const r = n.displayRadius;
      if (x - r < minX) minX = x - r;
      if (y - r < minY) minY = y - r;
      if (x + r > maxX) maxX = x + r;
      if (y + r + LABEL_PAD > maxY) maxY = y + r + LABEL_PAD;
    }
    minX -= PADDING;
    minY -= PADDING;
    maxX += PADDING;
    maxY += PADDING;

    const vbWidth = maxX - minX;
    const vbHeight = maxY - minY;

    // Determine output resolution — 2x for crispness, capped at 4096 on longest side
    const MAX_DIM = 4096;
    let scale = 2;
    if (Math.max(vbWidth, vbHeight) * scale > MAX_DIM) {
      scale = MAX_DIM / Math.max(vbWidth, vbHeight);
    }
    const canvasWidth = Math.round(vbWidth * scale);
    const canvasHeight = Math.round(vbHeight * scale);

    // Clone the SVG
    const svgNode = this.svg.node();
    if (!svgNode) return;
    const clone = svgNode.cloneNode(true) as SVGSVGElement;

    // Set viewBox and explicit dimensions on the clone
    clone.setAttribute("viewBox", `${minX} ${minY} ${vbWidth} ${vbHeight}`);
    clone.setAttribute("width", String(canvasWidth));
    clone.setAttribute("height", String(canvasHeight));
    // Remove any Tailwind classes that won't serialize
    clone.removeAttribute("class");

    // Remove the zoom transform on the container <g> — viewBox handles framing
    const containerG = clone.querySelector("g");
    if (containerG) {
      containerG.removeAttribute("transform");
    }

    // Prepend a background rect (slate-900)
    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("x", String(minX));
    bgRect.setAttribute("y", String(minY));
    bgRect.setAttribute("width", String(vbWidth));
    bgRect.setAttribute("height", String(vbHeight));
    bgRect.setAttribute("fill", "#0f172a");
    clone.insertBefore(bgRect, clone.firstChild);

    // Serialize to string
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(clone);

    // Draw onto an offscreen canvas via Image
    const img = new Image();
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    return new Promise<void>((resolve) => {
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
          canvas.toBlob((pngBlob) => {
            if (pngBlob) {
              // Generate filename: mqtt-vis-YYYY-MM-DDTHHMM.png
              const now = new Date();
              const ts = now.toISOString().slice(0, 16).replace(":", "");
              const a = document.createElement("a");
              a.href = URL.createObjectURL(pngBlob);
              a.download = `mqtt-vis-${ts}.png`;
              a.click();
              URL.revokeObjectURL(a.href);
            }
            URL.revokeObjectURL(url);
            resolve();
          }, "image/png");
        } else {
          URL.revokeObjectURL(url);
          resolve();
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      img.src = url;
    });
  }

  /** Clean up the renderer and stop the simulation. */
  destroy(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
    }
    if (this.tooltipDelayTimer !== null) {
      clearTimeout(this.tooltipDelayTimer);
    }
    this.simulation.stop();
    this.svg.selectAll("*").remove();
  }
}
