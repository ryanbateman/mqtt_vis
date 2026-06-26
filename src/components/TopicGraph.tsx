import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useTopicStore } from "../stores/topicStore";
import { GraphRenderer } from "./GraphRenderer";
import { NodeTooltip } from "./NodeTooltip";
import { findNode } from "../utils/topicParser";
import { TAG_REGISTRY } from "../utils/tagRegistry";
import type { TooltipData } from "../types";

/** Zoom level the auto-tour zooms in to when focusing a highlighted node. */
const AUTO_TOUR_FOCUS_SCALE = 1.4;

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
  const showLabels = useTopicStore((s) => s.showLabels);
  const labelDepthFactor = useTopicStore((s) => s.labelDepthFactor);
  const labelMode = useTopicStore((s) => s.labelMode);
  const labelFontSize = useTopicStore((s) => s.labelFontSize);
  const labelStrokeWidth = useTopicStore((s) => s.labelStrokeWidth);
  const scaleTextByDepth = useTopicStore((s) => s.scaleTextByDepth);
  const scaleNodeSizeByDepth = useTopicStore((s) => s.scaleNodeSizeByDepth);
  const emaTau = useTopicStore((s) => s.emaTau);
  const repulsionStrength = useTopicStore((s) => s.repulsionStrength);
  const linkDistance = useTopicStore((s) => s.linkDistance);
  const linkStrength = useTopicStore((s) => s.linkStrength);
  const collisionPadding = useTopicStore((s) => s.collisionPadding);
  const alphaDecay = useTopicStore((s) => s.alphaDecay);
  const showTooltips = useTopicStore((s) => s.showTooltips);
  const exportRequested = useTopicStore((s) => s.exportRequested);
  const selectedNodeId = useTopicStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useTopicStore((s) => s.setSelectedNodeId);
  const highlightedNodes = useTopicStore((s) => s.highlightedNodes);
  const centerNodeId = useTopicStore((s) => s.centerNodeId);
  const centerNodeNonce = useTopicStore((s) => s.centerNodeNonce);
  const fitViewNonce = useTopicStore((s) => s.fitViewNonce);
  const fitViewDuration = useTopicStore((s) => s.fitViewDuration);
  const displayMode = useTopicStore((s) => s.displayMode);
  // Joined ids of enabled insight tags — a primitive selector result, so the
  // component only re-renders when the enabled set actually changes.
  const enabledTagIds = useTopicStore((s) =>
    TAG_REGISTRY.filter((def) => s[def.settingsKey])
      .map((def) => def.id)
      .join(",")
  );

  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  // Callbacks for node click / background click (stable refs via useCallback)
  const handleNodeClick = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
    },
    [setSelectedNodeId]
  );

  const handleBackgroundClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  // Look up the hovered node's data for the tooltip
  const tooltipNodes = useMemo(() => {
    if (!tooltip) return null;
    const root = useTopicStore.getState().root;
    const segments = tooltip.nodeId === "" ? [] : tooltip.nodeId.split("/");
    const topicNode = findNode(root, segments);
    const graphNode = graphNodes.find((n) => n.id === tooltip.nodeId);
    if (!topicNode || !graphNode) return null;
    return { topicNode, graphNode };
  }, [tooltip, graphNodes]);

  // Initialize the renderer once the SVG element is mounted
  useEffect(() => {
    if (!svgRef.current) return;

    const renderer = new GraphRenderer(svgRef.current);
    rendererRef.current = renderer;
    renderer.setTooltipCallback(setTooltip);

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
      rendererRef.current.setShowLabels(showLabels);
    }
  }, [showLabels]);

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

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setLabelFontSize(labelFontSize);
    }
  }, [labelFontSize]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setLabelStrokeWidth(labelStrokeWidth);
    }
  }, [labelStrokeWidth]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setScaleTextByDepth(scaleTextByDepth);
    }
  }, [scaleTextByDepth]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setScaleNodeSizeByDepth(scaleNodeSizeByDepth);
    }
  }, [scaleNodeSizeByDepth]);

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

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setShowTooltips(showTooltips);
    }
  }, [showTooltips]);

  // Trigger PNG export when requested
  useEffect(() => {
    if (exportRequested > 0 && rendererRef.current) {
      rendererRef.current.exportPng();
    }
  }, [exportRequested]);

  // Sync click callbacks to the renderer
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setClickCallback(handleNodeClick);
      rendererRef.current.setBackgroundClickCallback(handleBackgroundClick);
    }
  }, [handleNodeClick, handleBackgroundClick]);

  // Sync selected node ID to the renderer for the selection ring
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setSelectedNodeId(selectedNodeId);
    }
  }, [selectedNodeId]);

  // Pan + zoom-in to centre a requested node (auto-tour). Keyed on the
  // nonce so repeated requests for the same id still fire. In auto-tour the floating
  // drawer covers the right side, so bias the centre left of it.
  // A fixed focus scale zooms in on the node (the rest-phase fitView zooms out).
  useEffect(() => {
    if (centerNodeNonce === 0 || !centerNodeId || !rendererRef.current) return;
    const xBias = displayMode === "autotour" ? -240 : 0;
    rendererRef.current.centerOnNode(centerNodeId, 3600, xBias, AUTO_TOUR_FOCUS_SCALE);
  }, [centerNodeNonce, centerNodeId, displayMode]);

  // Slow zoom-out to an overview while the auto-tour is between highlights.
  useEffect(() => {
    if (fitViewNonce === 0 || !rendererRef.current) return;
    rendererRef.current.fitView(fitViewDuration);
  }, [fitViewNonce, fitViewDuration]);

  // Sync highlighted nodes to the renderer
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setHighlightedNodes(highlightedNodes);
    }
  }, [highlightedNodes]);

  // Enable the animated pulse ring on the selected node only in auto-tour mode.
  useEffect(() => {
    rendererRef.current?.setAutoTourMode(displayMode === "autotour");
  }, [displayMode]);

  // Sync sparkplug offline state to the renderer. Offline devices contribute
  // every topic node their messages have arrived on (NBIRTH/NDATA/... are
  // sibling subtrees), so the whole family restyles at once.
  const sparkplugVersion = useTopicStore((s) => s.sparkplugVersion);
  useEffect(() => {
    if (!rendererRef.current) return;
    const offline = new Set<string>();
    for (const device of useTopicStore.getState().sparkplugDevices.values()) {
      if (!device.online) {
        for (const nodeId of device.topicNodeIds) offline.add(nodeId);
      }
    }
    rendererRef.current.setSparkplugOfflineNodes(offline);
  }, [sparkplugVersion]);

  // Sync insight ring settings to the renderer (colours from the tag registry)
  useEffect(() => {
    if (rendererRef.current) {
      const tags = new Map<string, string>();
      const enabled = new Set(enabledTagIds.split(","));
      for (const def of TAG_REGISTRY) {
        if (enabled.has(def.id)) {
          tags.set(def.id, def.ringColor);
        }
      }
      rendererRef.current.setEnabledInsightTags(tags);
    }
  }, [enabledTagIds]);

  // Escape key deselects the current node
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedNodeId !== null) {
        setSelectedNodeId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodeId, setSelectedNodeId]);

  return (
    <>
      <svg
        ref={svgRef}
        className="w-full h-full bg-slate-900"
      />
      {tooltip && tooltipNodes && (
        <NodeTooltip
          topicNode={tooltipNodes.topicNode}
          graphNode={tooltipNodes.graphNode}
          screenX={tooltip.screenX}
          screenY={tooltip.screenY}
        />
      )}
    </>
  );
}
