import { describe, it, expect } from "vitest";
import { calculateRadius, MIN_RADIUS, MAX_RADIUS, MAX_RATE } from "../sizeCalculator";

describe("sizeCalculator constants", () => {
  it("should have MIN_RADIUS = 8", () => {
    expect(MIN_RADIUS).toBe(8);
  });

  it("should have MAX_RADIUS = 60", () => {
    expect(MAX_RADIUS).toBe(60);
  });

  it("should have MAX_RATE = 50", () => {
    expect(MAX_RATE).toBe(50);
  });

  it("should have MIN_RADIUS < MAX_RADIUS", () => {
    expect(MIN_RADIUS).toBeLessThan(MAX_RADIUS);
  });
});

describe("calculateRadius", () => {
  it("should return MIN_RADIUS for rate = 0", () => {
    expect(calculateRadius(0)).toBe(MIN_RADIUS);
  });

  it("should return MIN_RADIUS for negative rates", () => {
    expect(calculateRadius(-1)).toBe(MIN_RADIUS);
    expect(calculateRadius(-100)).toBe(MIN_RADIUS);
  });

  it("should return MAX_RADIUS for rate = MAX_RATE", () => {
    const result = calculateRadius(MAX_RATE);
    expect(result).toBeCloseTo(MAX_RADIUS, 5);
  });

  it("should clamp to MAX_RADIUS for rates above MAX_RATE", () => {
    const atMax = calculateRadius(MAX_RATE);
    const aboveMax = calculateRadius(MAX_RATE * 10);
    expect(aboveMax).toBeCloseTo(MAX_RADIUS, 5);
    expect(aboveMax).toBeGreaterThanOrEqual(atMax - 0.001);
  });

  it("should be between MIN_RADIUS and MAX_RADIUS for rate = 1", () => {
    const result = calculateRadius(1);
    expect(result).toBeGreaterThan(MIN_RADIUS);
    expect(result).toBeLessThan(MAX_RADIUS);
  });

  it("should be monotonically increasing", () => {
    const rates = [0, 0.1, 0.5, 1, 2, 5, 10, 25, 50, 100];
    const radii = rates.map(calculateRadius);
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeGreaterThanOrEqual(radii[i - 1]);
    }
  });

  it("should grow logarithmically (not linearly)", () => {
    // The first unit of rate should cause a larger proportional increase
    // than going from 49 to 50.
    const r0 = calculateRadius(0);
    const r1 = calculateRadius(1);
    const r49 = calculateRadius(49);
    const r50 = calculateRadius(50);

    const firstJump = r1 - r0;
    const lastJump = r50 - r49;
    expect(firstJump).toBeGreaterThan(lastJump);
  });
});
