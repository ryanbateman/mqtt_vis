/**
 * Pure formatting utilities extracted from UI components for testability.
 * All functions are side-effect-free.
 */

/**
 * Format a message rate for display.
 * - Rates below 0.01 are shown as "0".
 * - Rates below 1 get 2 decimal places.
 * - Rates below 10 get 1 decimal place.
 * - Rates >= 10 are rounded to the nearest integer.
 */
export function formatRate(rate: number): string {
  if (rate < 0.01) return "0";
  if (rate < 1) return rate.toFixed(2);
  if (rate < 10) return rate.toFixed(1);
  return Math.round(rate).toString();
}

/**
 * Format a UNIX timestamp (ms) as a locale time string.
 * Returns "never" for timestamp 0 (no message received yet).
 */
export function formatTimestamp(ts: number): string {
  if (ts === 0) return "never";
  const date = new Date(ts);
  return date.toLocaleTimeString();
}

/**
 * Truncate a payload string for tooltip display.
 * Returns "(none)" for null payloads.
 * Appends "..." if the payload exceeds maxChars.
 */
export function truncatePayload(
  payload: string | null,
  maxChars: number = 120
): string {
  if (payload === null) return "(none)";
  if (payload.length <= maxChars) return payload;
  return payload.slice(0, maxChars) + "...";
}

/**
 * Format a duration in milliseconds as a human-readable uptime string.
 * Uses the format "Xh Ym Zs", "Xm Ys", or "Xs" depending on magnitude.
 */
export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Apply inverse depth scaling to a value.
 * Uses the formula: `value / (1 + depth * factor)`.
 * At depth 0, returns the full value; deeper levels get progressively smaller.
 *
 * @param value  The base value (font size, radius, etc.)
 * @param depth  Tree depth (0 = root)
 * @param factor Dropoff rate. Higher = faster shrinkage. Default 0.4 (used for nodes).
 *               Text scaling uses 0.25 for a gentler dropoff.
 */
export function depthScale(value: number, depth: number, factor: number = 0.4): number {
  return value / (1 + depth * factor);
}

/** @deprecated Use `depthScale` instead. Alias kept for backward compatibility. */
export const depthFontSize = depthScale;

/**
 * Format a payload character count as a human-readable size string.
 * Since payloads arrive as decoded strings, character count approximates bytes
 * closely for typical ASCII/UTF-8 MQTT payloads.
 *
 * - < 1024: shown as "N B"
 * - < 1 048 576: shown as "N.N kB"
 * - ≥ 1 048 576: shown as "N.N MB"
 */
export function formatPayloadSize(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} kB`;
  return `${(chars / (1024 * 1024)).toFixed(1)} MB`;
}
