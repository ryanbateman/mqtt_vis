/** Minimum node radius in pixels. */
export const MIN_RADIUS = 8;

/** Maximum node radius in pixels. */
export const MAX_RADIUS = 60;

/**
 * The aggregate rate at which a node reaches maximum size.
 * Tunable — higher values mean nodes need more traffic to grow large.
 */
export const MAX_RATE = 50;

/**
 * Calculate node radius from aggregate message rate using a logarithmic scale.
 *
 * radius = MIN_R + (MAX_R - MIN_R) * (log(1 + rate) / log(1 + MAX_RATE))
 *
 * This ensures:
 * - rate=0 → MIN_RADIUS
 * - rate=MAX_RATE → MAX_RADIUS
 * - Growth is logarithmic, preventing high-frequency topics from dominating
 */
export function calculateRadius(aggregateRate: number): number {
  if (aggregateRate <= 0) return MIN_RADIUS;

  const normalized = Math.log(1 + aggregateRate) / Math.log(1 + MAX_RATE);
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.min(normalized, 1);
}
