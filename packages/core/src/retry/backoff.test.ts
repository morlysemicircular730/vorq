import { describe, expect, it } from "vitest";
import { ExponentialBackoff } from "./exponential-backoff.js";
import { ExponentialJitterBackoff } from "./exponential-jitter-backoff.js";
import { FixedBackoff } from "./fixed-backoff.js";

describe("FixedBackoff", () => {
  it("returns constant delay", () => {
    const backoff = new FixedBackoff(5000);
    expect(backoff.calculate(1)).toBe(5000);
    expect(backoff.calculate(2)).toBe(5000);
    expect(backoff.calculate(10)).toBe(5000);
  });
});

describe("ExponentialBackoff", () => {
  it("returns exponentially increasing delay", () => {
    const backoff = new ExponentialBackoff(1000, 60000);
    expect(backoff.calculate(1)).toBe(1000);
    expect(backoff.calculate(2)).toBe(2000);
    expect(backoff.calculate(3)).toBe(4000);
    expect(backoff.calculate(4)).toBe(8000);
  });

  it("caps at maxDelay", () => {
    const backoff = new ExponentialBackoff(1000, 5000);
    expect(backoff.calculate(10)).toBe(5000);
  });
});

describe("ExponentialJitterBackoff", () => {
  it("returns value between 1 and exponential delay", () => {
    const backoff = new ExponentialJitterBackoff(1000, 60000);
    for (let i = 0; i < 100; i++) {
      const delay = backoff.calculate(3);
      expect(delay).toBeGreaterThanOrEqual(1);
      expect(delay).toBeLessThanOrEqual(4000);
    }
  });

  it("caps at maxDelay", () => {
    const backoff = new ExponentialJitterBackoff(1000, 3000);
    for (let i = 0; i < 100; i++) {
      const delay = backoff.calculate(20);
      expect(delay).toBeLessThanOrEqual(3000);
    }
  });
});
