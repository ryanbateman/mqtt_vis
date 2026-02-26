import { scaleLog, scaleLinear } from "d3-scale";
import { interpolateRgb } from "d3-interpolate";

/**
 * Colour palette for nodes against a dark slate (#0f172a) background.
 * Idle nodes are a visible cool blue; active nodes warm through
 * orange to hot white-yellow.
 */
const COLOR_STOPS = [
  "#64748b", // idle:  slate-500 — clearly visible on dark navy
  "#38bdf8", // low:   sky-400  — cool blue glow
  "#f97316", // mid:   orange-500
  "#fbbf24", // high:  amber-400
  "#fef08a", // peak:  yellow-200 — near-white hot
];

/** Build a linear interpolator across multiple colour stops. */
function multiColorScale(t: number): string {
  const n = COLOR_STOPS.length - 1;
  const segment = Math.min(Math.floor(t * n), n - 1);
  const local = t * n - segment;
  return interpolateRgb(COLOR_STOPS[segment], COLOR_STOPS[segment + 1])(local);
}

/**
 * Base colour for idle nodes (slate-500).
 * Light enough to be clearly visible on the dark navy background.
 */
export const IDLE_COLOR = COLOR_STOPS[0];

/**
 * Create a colour from a message rate.
 * Maps rate through the colour stops: slate → sky blue → orange → amber → yellow.
 */
export function rateToColor(messageRate: number): string {
  if (messageRate <= 0) return IDLE_COLOR;

  const scale = scaleLog()
    .domain([0.01, 100])
    .range([0.05, 1.0])
    .clamp(true);

  return multiColorScale(scale(Math.max(messageRate, 0.01)));
}

/**
 * Get a glow colour for pulse effects — brighter, more saturated.
 * Returns colours from the warm/hot end of the scale.
 */
export function pulseColor(messageRate: number): string {
  if (messageRate <= 0) return COLOR_STOPS[2]; // orange

  const scale = scaleLog()
    .domain([0.01, 100])
    .range([0.5, 1.0])
    .clamp(true);

  return multiColorScale(scale(Math.max(messageRate, 0.01)));
}

/**
 * Get a colour for a node's stroke when idle.
 * Slightly brighter than the fill for subtle definition.
 */
export const IDLE_STROKE = "#94a3b8"; // slate-400

/**
 * Map a 0-1 parameter to a link colour.
 * Unused for now but available for future rate-based link colouring.
 */
export function linkColor(_rate: number): string {
  const scale = scaleLinear<string>()
    .domain([0, 1])
    .range(["#475569", "#94a3b8"])
    .clamp(true);
  return scale(_rate);
}
