import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTopicStore } from "../stores/topicStore";
import { getConfig } from "../utils/config";

type SettingsTab = "visual" | "labels" | "simulation";

/** Small info icon with hover tooltip rendered via portal to avoid clipping. */
function InfoTooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const iconRef = useRef<SVGSVGElement>(null);

  const show = useCallback(() => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      setPos({ x: rect.left + rect.width / 2, y: rect.top });
    }
    setVisible(true);
  }, []);

  return (
    <span
      className="inline-flex items-center"
      onMouseEnter={show}
      onMouseLeave={() => setVisible(false)}
    >
      <svg
        ref={iconRef}
        className="w-3.5 h-3.5 text-gray-500 hover:text-gray-300 cursor-help transition-colors"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
      </svg>
      {visible &&
        createPortal(
          <span
            className="fixed px-2 py-1 text-[11px] leading-tight text-gray-200 bg-gray-800 border border-gray-600 rounded shadow-lg max-w-48 z-[9999] pointer-events-none"
            style={{
              left: pos.x,
              top: pos.y,
              transform: "translate(-50%, -100%) translateY(-6px)",
            }}
          >
            {text}
          </span>,
          document.body
        )}
    </span>
  );
}

/** A single slider row. */
function SliderRow({
  label,
  tooltip,
  value,
  displayValue,
  min,
  max,
  step,
  minLabel,
  maxLabel,
  onChange,
}: {
  label: string;
  tooltip: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  step: number;
  minLabel: string;
  maxLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-gray-400">{label}</label>
          <InfoTooltip text={tooltip} />
        </div>
        <span className="text-xs font-mono text-gray-300">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] text-gray-500">{minLabel}</span>
        <span className="text-[10px] text-gray-500">{maxLabel}</span>
      </div>
    </div>
  );
}

/** Tab button for the settings panel tab bar. */
function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-2 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "bg-gray-800 text-gray-400 hover:text-gray-200"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Settings panel positioned at the top-right of the viewport.
 * Provides sliders for visual and simulation parameters with
 * tabbed sections and info-icon tooltips.
 */
export function SettingsPanel() {
  const cfg = getConfig();
  const [collapsed, setCollapsed] = useState(cfg.settingsCollapsed ?? false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("visual");
  const emaTau = useTopicStore((s) => s.emaTau);
  const setEmaTau = useTopicStore((s) => s.setEmaTau);
  const showLabels = useTopicStore((s) => s.showLabels);
  const setShowLabels = useTopicStore((s) => s.setShowLabels);
  const labelDepthFactor = useTopicStore((s) => s.labelDepthFactor);
  const setLabelDepthFactor = useTopicStore((s) => s.setLabelDepthFactor);
  const labelMode = useTopicStore((s) => s.labelMode);
  const setLabelMode = useTopicStore((s) => s.setLabelMode);
  const repulsionStrength = useTopicStore((s) => s.repulsionStrength);
  const setRepulsionStrength = useTopicStore((s) => s.setRepulsionStrength);
  const linkDistance = useTopicStore((s) => s.linkDistance);
  const setLinkDistance = useTopicStore((s) => s.setLinkDistance);
  const linkStrength = useTopicStore((s) => s.linkStrength);
  const setLinkStrength = useTopicStore((s) => s.setLinkStrength);
  const collisionPadding = useTopicStore((s) => s.collisionPadding);
  const setCollisionPadding = useTopicStore((s) => s.setCollisionPadding);
  const alphaDecay = useTopicStore((s) => s.alphaDecay);
  const setAlphaDecay = useTopicStore((s) => s.setAlphaDecay);
  const ancestorPulse = useTopicStore((s) => s.ancestorPulse);
  const setAncestorPulse = useTopicStore((s) => s.setAncestorPulse);
  const showRootPath = useTopicStore((s) => s.showRootPath);
  const setShowRootPath = useTopicStore((s) => s.setShowRootPath);
  const labelFontSize = useTopicStore((s) => s.labelFontSize);
  const setLabelFontSize = useTopicStore((s) => s.setLabelFontSize);
  const scaleTextByDepth = useTopicStore((s) => s.scaleTextByDepth);
  const setScaleTextByDepth = useTopicStore((s) => s.setScaleTextByDepth);
  const showTooltips = useTopicStore((s) => s.showTooltips);
  const setShowTooltips = useTopicStore((s) => s.setShowTooltips);
  const nodeScale = useTopicStore((s) => s.nodeScale);
  const setNodeScale = useTopicStore((s) => s.setNodeScale);
  const scaleNodeSizeByDepth = useTopicStore((s) => s.scaleNodeSizeByDepth);
  const setScaleNodeSizeByDepth = useTopicStore((s) => s.setScaleNodeSizeByDepth);
  const resetSettings = useTopicStore((s) => s.resetSettings);

  const [confirmReset, setConfirmReset] = useState(false);
  // Auto-revert the confirmation prompt after 3 seconds
  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  return (
    <div className="absolute top-4 right-4 z-10 bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg p-4 shadow-xl w-64 max-h-[calc(100vh-2rem)] overflow-y-auto">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-gray-100 transition-colors w-full"
      >
        <svg
          className={`w-3 h-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
            clipRule="evenodd"
          />
        </svg>
        Settings
      </button>

      {!collapsed && <>
        {/* Tab bar */}
        <div className="flex rounded overflow-hidden border border-gray-600 mt-3">
          <TabButton label="Visual" active={activeTab === "visual"} onClick={() => setActiveTab("visual")} />
          <TabButton label="Labels" active={activeTab === "labels"} onClick={() => setActiveTab("labels")} />
          <TabButton label="Simulate" active={activeTab === "simulation"} onClick={() => setActiveTab("simulation")} />
        </div>

        {/* Tab content */}
        <div className="space-y-3 mt-3">
          {activeTab === "visual" && (
            <>
              <SliderRow
                label="Fade Time"
                tooltip="How long messages affect node size and colour"
                value={emaTau}
                displayValue={`${emaTau.toFixed(1)}s`}
                min={0.5}
                max={30}
                step={0.5}
                minLabel="Fast"
                maxLabel="Slow"
                onChange={setEmaTau}
              />
              <SliderRow
                label="Node Scale"
                tooltip="Scale all node sizes. Affects both minimum and maximum radius proportionally."
                value={nodeScale}
                displayValue={`${nodeScale.toFixed(1)}x`}
                min={0.5}
                max={4.0}
                step={0.1}
                minLabel="Small"
                maxLabel="Large"
                onChange={setNodeScale}
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-gray-400">
                    Scale Nodes by Depth
                  </label>
                  <InfoTooltip text="Deeper nodes rendered smaller. Root nodes keep full size, children shrink progressively." />
                </div>
                <input
                  type="checkbox"
                  checked={scaleNodeSizeByDepth}
                  onChange={(e) => setScaleNodeSizeByDepth(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-blue-500 accent-blue-500 cursor-pointer"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-gray-400">
                    Ancestor Pulse
                  </label>
                  <InfoTooltip text="When a message arrives, pulse all parent nodes up to the root" />
                </div>
                <input
                  type="checkbox"
                  checked={ancestorPulse}
                  onChange={(e) => setAncestorPulse(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-blue-500 accent-blue-500 cursor-pointer"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-gray-400">
                    Show Root Path
                  </label>
                  <InfoTooltip text="Show ancestor nodes above the subscription prefix (e.g. for test/robot/#, hides test and robot when off)" />
                </div>
                <input
                  type="checkbox"
                  checked={showRootPath}
                  onChange={(e) => setShowRootPath(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-blue-500 accent-blue-500 cursor-pointer"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-gray-400">
                    Hover Tooltips
                  </label>
                  <InfoTooltip text="Show a tooltip with topic details when hovering over a node" />
                </div>
                <input
                  type="checkbox"
                  checked={showTooltips}
                  onChange={(e) => setShowTooltips(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-blue-500 accent-blue-500 cursor-pointer"
                />
              </div>
            </>
          )}

          {activeTab === "labels" && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-gray-400">Labels</label>
                  <InfoTooltip text="Show or hide text labels on nodes" />
                </div>
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-blue-500 accent-blue-500 cursor-pointer"
                />
              </div>
              {showLabels && (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <label className="text-xs font-medium text-gray-400">Label Mode</label>
                        <InfoTooltip text={labelMode === "zoom"
                          ? "Labels fade in/out based on zoom level and depth"
                          : "Labels shown/hidden by a fixed tree depth cutoff"
                        } />
                      </div>
                      <div className="flex rounded overflow-hidden border border-gray-600">
                        <button
                          type="button"
                          onClick={() => setLabelMode("zoom")}
                          className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            labelMode === "zoom"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-800 text-gray-400 hover:text-gray-200"
                          }`}
                        >
                          Zoom
                        </button>
                        <button
                          type="button"
                          onClick={() => setLabelMode("depth")}
                          className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            labelMode === "depth"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-800 text-gray-400 hover:text-gray-200"
                          }`}
                        >
                          Depth
                        </button>
                      </div>
                    </div>
                  </div>
                  <SliderRow
                    label={labelMode === "zoom" ? "Label Depth" : "Max Label Depth"}
                    tooltip={labelMode === "zoom"
                      ? "How many levels of labels stay visible when zoomed out"
                      : "Labels are hidden below this tree depth"
                    }
                    value={labelDepthFactor}
                    displayValue={`${labelDepthFactor}`}
                    min={labelMode === "zoom" ? 2 : 1}
                    max={20}
                    step={1}
                    minLabel="Fewer"
                    maxLabel="More"
                    onChange={setLabelDepthFactor}
                  />
                  <SliderRow
                    label="Font Size"
                    tooltip={scaleTextByDepth
                      ? "Maximum font size (at root level). Deeper nodes use progressively smaller text."
                      : "Font size for all labels"
                    }
                    value={labelFontSize}
                    displayValue={`${labelFontSize}px`}
                    min={6}
                    max={32}
                    step={1}
                    minLabel="Small"
                    maxLabel="Large"
                    onChange={setLabelFontSize}
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs font-medium text-gray-400">
                        Scale by Depth
                      </label>
                      <InfoTooltip text="Largest text at root, decreasing for deeper nodes. Font Size slider sets the maximum." />
                    </div>
                    <input
                      type="checkbox"
                      checked={scaleTextByDepth}
                      onChange={(e) => setScaleTextByDepth(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-blue-500 accent-blue-500 cursor-pointer"
                    />
                  </div>
                </>
              )}
            </>
          )}

          {activeTab === "simulation" && (
            <>
              <SliderRow
                label="Repulsion"
                tooltip="How strongly nodes push each other apart"
                value={Math.abs(repulsionStrength)}
                displayValue={`${repulsionStrength}`}
                min={20}
                max={500}
                step={10}
                minLabel="Compact"
                maxLabel="Spread"
                onChange={(v) => setRepulsionStrength(-v)}
              />
              <SliderRow
                label="Link Distance"
                tooltip="Ideal spacing between connected parent-child nodes"
                value={linkDistance}
                displayValue={`${linkDistance}px`}
                min={20}
                max={300}
                step={5}
                minLabel="Tight"
                maxLabel="Spacious"
                onChange={setLinkDistance}
              />
              <SliderRow
                label="Link Strength"
                tooltip="How rigidly links enforce their ideal distance"
                value={linkStrength}
                displayValue={linkStrength.toFixed(2)}
                min={0.05}
                max={1}
                step={0.05}
                minLabel="Flexible"
                maxLabel="Rigid"
                onChange={setLinkStrength}
              />
              <SliderRow
                label="Collision Gap"
                tooltip="Extra space around nodes to prevent overlap"
                value={collisionPadding}
                displayValue={`${collisionPadding}px`}
                min={0}
                max={20}
                step={1}
                minLabel="None"
                maxLabel="Wide"
                onChange={setCollisionPadding}
              />
              <SliderRow
                label="Settle Speed"
                tooltip="How quickly the graph stops moving after changes"
                value={alphaDecay}
                displayValue={alphaDecay.toFixed(3)}
                min={0.001}
                max={0.05}
                step={0.001}
                minLabel="Slow"
                maxLabel="Fast"
                onChange={setAlphaDecay}
              />
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (confirmReset) {
              resetSettings();
              setConfirmReset(false);
            } else {
              setConfirmReset(true);
            }
          }}
          className={`w-full mt-3 pt-3 border-t border-gray-700 text-xs transition-colors ${
            confirmReset
              ? "text-amber-400 hover:text-amber-300"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          {confirmReset ? "Click again to confirm reset" : "Reset to Defaults"}
        </button>
      </>}
    </div>
  );
}
