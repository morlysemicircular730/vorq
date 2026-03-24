import { describe, expect, it, vi } from "vitest";
import type { BackoffStrategy } from "../task/types.js";
import { ExponentialJitterBackoff } from "./exponential-jitter-backoff.js";
import { RetryPolicy } from "./retry-policy.js";

describe("RetryPolicy", () => {
  describe("shouldRetry", () => {
    it("returns true when attempt < maxRetries", () => {
      const policy = new RetryPolicy({ maxRetries: 3 });
      expect(policy.shouldRetry(0, new Error("fail"))).toBe(true);
      expect(policy.shouldRetry(1, new Error("fail"))).toBe(true);
      expect(policy.shouldRetry(2, new Error("fail"))).toBe(true);
    });

    it("returns false when attempt >= maxRetries", () => {
      const policy = new RetryPolicy({ maxRetries: 3 });
      expect(policy.shouldRetry(3, new Error("fail"))).toBe(false);
      expect(policy.shouldRetry(4, new Error("fail"))).toBe(false);
    });

    it("returns false when error is not in retryableErrors", () => {
      const policy = new RetryPolicy({
        maxRetries: 3,
        retryableErrors: ["TimeoutError", "NetworkError"],
      });
      const error = new Error("something broke");
      error.name = "ValidationError";
      expect(policy.shouldRetry(0, error)).toBe(false);
    });

    it("returns true when error is in retryableErrors", () => {
      const policy = new RetryPolicy({
        maxRetries: 3,
        retryableErrors: ["TimeoutError", "NetworkError"],
      });
      const error = new Error("timed out");
      error.name = "TimeoutError";
      expect(policy.shouldRetry(0, error)).toBe(true);
    });

    it("retries any error when retryableErrors is not configured", () => {
      const policy = new RetryPolicy({ maxRetries: 3 });
      const errors = [
        Object.assign(new Error("a"), { name: "TypeError" }),
        Object.assign(new Error("b"), { name: "RangeError" }),
        Object.assign(new Error("c"), { name: "CustomError" }),
      ];
      for (const error of errors) {
        expect(policy.shouldRetry(0, error)).toBe(true);
      }
    });
  });

  describe("getDelay", () => {
    it("delegates to the backoff strategy", () => {
      const backoff: BackoffStrategy = { calculate: vi.fn().mockReturnValue(500) };
      const policy = new RetryPolicy({ maxRetries: 3, backoff });

      const delay = policy.getDelay(2);

      expect(delay).toBe(500);
      expect(backoff.calculate).toHaveBeenCalledWith(2);
    });
  });

  describe("default backoff", () => {
    it("uses ExponentialJitterBackoff when no backoff is provided", () => {
      const policy = new RetryPolicy({ maxRetries: 3 });
      expect(policy.backoff).toBeInstanceOf(ExponentialJitterBackoff);
    });
  });
});
