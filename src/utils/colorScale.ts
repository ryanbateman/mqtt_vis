import { interpolateInferno } from "d3-scale-chromatic";
import { scaleLog } from "d3-scale";

/**
 * Base colour for idle nodes (very dark purple from the inferno scale).
 * Matches the low end of the inferno colour map.
 */
export const IDLE_COLOR = interpolateInferno(0.05);

/**
 * Create a colour from a message rate.
 * Maps rate → position on the inferno colour scale (0.05 to 0.95).
 * Low rates are cool dark purples, high rates are hot yellows.
 */
export function rateToColor(messageRate: number): string {
  if (messageRate <= 0) return IDLE_COLOR;

  // Log scale from 0.01 to 100 msgs/sec → mapped to 0.05..0.95 on inferno
  const scale = scaleLog()
    .domain([0.01, 100])
    .range([0.05, 0.95])
    .clamp(true);

  return interpolateInferno(scale(Math.max(messageRate, 0.01)));
}

/**
 * Get a glow colour for pulse effects — brighter, more saturated version.
 * Uses the high end of the inferno scale for a hot glow.
 */
export function pulseColor(messageRate: number): string {
  if (messageRate <= 0) return interpolateInferno(0.5);

  const scale = scaleLog()
    .domain([0.01, 100])
    .range([0.5, 1.0])
    .clamp(true);

  return interpolateInferno(scale(Math.max(messageRate, 0.01)));
}
