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

  const graphNodes = useTopicStore((s) => s.graphNodes);
  const graphLinks = useTopicStore((s) => s.graphLinks);

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

  // Update the graph whenever nodes/links change
  useEffect(() => {
    if (rendererRef.current && graphNodes.length > 0) {
      rendererRef.current.update(graphNodes, graphLinks);
    }
  }, [graphNodes, graphLinks]);

  return (
    <svg
      ref={svgRef}
      className="w-full h-full bg-gray-950"
    />
  );
}
