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
 * Calculate font size for a label based on its tree depth.
 * Uses an inverse falloff: `baseSize / (1 + depth * 0.3)`.
 * Root nodes (depth 0) get the full baseSize; deeper nodes get progressively smaller text.
 */
export function depthFontSize(baseSize: number, depth: number): number {
  return baseSize / (1 + depth * 0.3);
}
