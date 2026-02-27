import { useEffect, useRef } from "react";
import { useTopicStore } from "../stores/topicStore";
import { GraphRenderer } from "./GraphRenderer";

/**
 * React component that owns the SVG container.
 * D3 (via GraphRenderer) manages all SVG content inside the ref.
 */
export function TopicGraph() {
  const svgRef = useRef<SVGSVGElement>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
  const lastStructureVersionRef = useRef<number>(-1);

  const graphNodes = useTopicStore((s) => s.graphNodes);
  const graphLinks = useTopicStore((s) => s.graphLinks);
  const graphStructureVersion = useTopicStore((s) => s.graphStructureVersion);
  const labelDepthFactor = useTopicStore((s) => s.labelDepthFactor);
  const labelMode = useTopicStore((s) => s.labelMode);
  const emaTau = useTopicStore((s) => s.emaTau);
  const repulsionStrength = useTopicStore((s) => s.repulsionStrength);
  const linkDistance = useTopicStore((s) => s.linkDistance);
  const linkStrength = useTopicStore((s) => s.linkStrength);
  const collisionPadding = useTopicStore((s) => s.collisionPadding);
  const alphaDecay = useTopicStore((s) => s.alphaDecay);

  // Initialize the renderer once the SVG element is mounted
  useEffect(() => {
    if (!svgRef.current) return;

    const renderer = new GraphRenderer(svgRef.current);
    rendererRef.current = renderer;

    // Handle resize
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        renderer.resize(width, height);
      }
    });
    observer.observe(svgRef.current);

    return () => {
      observer.disconnect();
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // Update the graph whenever nodes/links change.
  // Use graphStructureVersion to decide between full D3 data join (structural)
  // and lightweight in-place data sync (rate-only).
  useEffect(() => {
    if (!rendererRef.current) return;

    if (graphStructureVersion !== lastStructureVersionRef.current) {
      // Structural change: new nodes added or removed — full D3 data join
      lastStructureVersionRef.current = graphStructureVersion;
      rendererRef.current.update(graphNodes, graphLinks);
    } else {
      // Rate-only change: update data in-place, skip data join
      rendererRef.current.updateData(graphNodes, graphLinks);
    }
  }, [graphNodes, graphLinks, graphStructureVersion]);

  // Sync settings to the renderer
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setLabelDepthFactor(labelDepthFactor);
    }
  }, [labelDepthFactor]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setLabelMode(labelMode);
    }
  }, [labelMode]);

  // Sync fade duration: "Fade Time = 5s" means a 5-second fade window.
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setFadeDuration(emaTau * 1000);
    }
  }, [emaTau]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setRepulsionStrength(repulsionStrength);
    }
  }, [repulsionStrength]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setLinkDistance(linkDistance);
    }
  }, [linkDistance]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setLinkStrength(linkStrength);
    }
  }, [linkStrength]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setCollisionPadding(collisionPadding);
    }
  }, [collisionPadding]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setAlphaDecay(alphaDecay);
    }
  }, [alphaDecay]);

  return (
    <svg
      ref={svgRef}
      className="w-full h-full bg-slate-900"
    />
  );
}
