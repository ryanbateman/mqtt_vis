import * as d3 from "d3";
import type { GraphNode, GraphLink, Particle } from "../types";
import { rateToColor, pulseColor } from "../utils/colorScale";

/** Maximum number of particles alive at once. */
const MAX_PARTICLES = 500;

/** Number of particles spawned per message pulse. */
const PARTICLES_PER_PULSE = 6;

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
  private nodeGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private labelGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private particleGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;

  private particles: Particle[] = [];
  private animationFrame: number | null = null;
  private width = 0;
  private height = 0;

  // Track which nodes have been pulsed to avoid re-triggering
  private lastPulseTimestamps = new Map<string, number>();

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
        this.container.attr("transform", event.transform);
      });

    this.svg.call(zoom);

    // Layer ordering: links → nodes → particles → labels
    this.linkGroup = this.container.append("g").attr("class", "links");
    this.nodeGroup = this.container.append("g").attr("class", "nodes");
    this.particleGroup = this.container.append("g").attr("class", "particles");
    this.labelGroup = this.container.append("g").attr("class", "labels");

    // Initialize empty selections
    this.linkElements = this.linkGroup.selectAll<SVGLineElement, GraphLink>("line");
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
        d3.forceCollide<GraphNode>().radius((d) => d.radius + 4)
      )
      .alphaDecay(0.01)
      .on("tick", () => this.tick());
  }

  /** Update the graph with new node/link data. */
  update(nodes: GraphNode[], links: GraphLink[]): void {
    // Preserve existing node positions
    const oldPositions = new Map<string, { x: number; y: number; vx: number; vy: number }>();
    this.simulation.nodes().forEach((n) => {
      if (n.x !== undefined && n.y !== undefined) {
        oldPositions.set(n.id, {
          x: n.x,
          y: n.y,
          vx: n.vx ?? 0,
          vy: n.vy ?? 0,
        });
      }
    });

    // Apply preserved positions to new nodes
    for (const node of nodes) {
      const old = oldPositions.get(node.id);
      if (old) {
        node.x = old.x;
        node.y = old.y;
        node.vx = old.vx;
        node.vy = old.vy;
      } else {
        // New nodes: place near center with some jitter
        node.x = this.width / 2 + (Math.random() - 0.5) * 100;
        node.y = this.height / 2 + (Math.random() - 0.5) * 100;
      }
    }

    // Update simulation data
    this.simulation.nodes(nodes);
    (this.simulation.force("link") as d3.ForceLink<GraphNode, GraphLink>).links(links);

    // Update collide force with current radii
    (this.simulation.force("collide") as d3.ForceCollide<GraphNode>).radius(
      (d) => d.radius + 4
    );

    // Reheat simulation slightly for new nodes
    this.simulation.alpha(0.3).restart();

    // Check for new pulses and spawn particles
    for (const node of nodes) {
      if (node.pulse) {
        const lastPulse = this.lastPulseTimestamps.get(node.id) ?? 0;
        if (node.pulseTimestamp > lastPulse) {
          this.lastPulseTimestamps.set(node.id, node.pulseTimestamp);
          this.spawnParticles(node);
        }
      }
    }

    // --- Update links ---
    this.linkElements = this.linkGroup
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(links, (d) => `${(d.source as GraphNode).id ?? d.source}-${(d.target as GraphNode).id ?? d.target}`);

    this.linkElements.exit().remove();

    this.linkElements = this.linkElements
      .enter()
      .append("line")
      .attr("stroke", "#374151")
      .attr("stroke-width", 1)
      .attr("stroke-opacity", 0.6)
      .merge(this.linkElements);

    // --- Update nodes ---
    this.nodeElements = this.nodeGroup
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(nodes, (d) => d.id);

    this.nodeElements.exit().remove();

    const entered = this.nodeElements
      .enter()
      .append("circle")
      .attr("stroke-width", 2)
      .call(this.setupDrag());

    this.nodeElements = entered.merge(this.nodeElements);

    // Update all node visual properties
    this.nodeElements
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => rateToColor(d.messageRate))
      .attr("stroke", (d) => (d.pulse ? pulseColor(d.messageRate) : "#1f2937"))
      .attr("filter", (d) => (d.pulse ? "url(#glow)" : "none"))
      .attr("stroke-opacity", (d) => (d.pulse ? 1 : 0.5));

    // --- Update labels ---
    this.labelElements = this.labelGroup
      .selectAll<SVGTextElement, GraphNode>("text")
      .data(nodes, (d) => d.id);

    this.labelElements.exit().remove();

    this.labelElements = this.labelElements
      .enter()
      .append("text")
      .attr("text-anchor", "middle")
      .attr("fill", "#d1d5db")
      .attr("font-size", "11px")
      .attr("font-family", "monospace")
      .attr("pointer-events", "none")
      .merge(this.labelElements)
      .text((d) => d.label);
  }

  /** Position elements on each simulation tick. */
  private tick(): void {
    this.linkElements
      .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
      .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
      .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
      .attr("y2", (d) => (d.target as GraphNode).y ?? 0);

    this.nodeElements
      .attr("cx", (d) => d.x ?? 0)
      .attr("cy", (d) => d.y ?? 0);

    this.labelElements
      .attr("x", (d) => d.x ?? 0)
      .attr("y", (d) => (d.y ?? 0) + d.radius + 14);
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

  /** Animation loop for particles. */
  private startAnimationLoop(): void {
    const animate = () => {
      this.updateParticles();
      this.renderParticles();
      this.animationFrame = requestAnimationFrame(animate);
    };
    this.animationFrame = requestAnimationFrame(animate);
  }

  /** Update particle positions and lifetimes. */
  private updateParticles(): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.98; // friction
      p.vy *= 0.98;
      p.life -= 0.02;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  /** Render particles as SVG circles. */
  private renderParticles(): void {
    const circles = this.particleGroup
      .selectAll<SVGCircleElement, Particle>("circle")
      .data(this.particles);

    circles.exit().remove();

    circles
      .enter()
      .append("circle")
      .merge(circles)
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y)
      .attr("r", (d) => d.radius * d.life)
      .attr("fill", (d) => d.color)
      .attr("opacity", (d) => d.life * 0.8);
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

  /** Clean up the renderer and stop the simulation. */
  destroy(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.simulation.stop();
    this.svg.selectAll("*").remove();
  }
}
