import type { BackoffStrategy } from "../task/types.js";
import { ExponentialJitterBackoff } from "./exponential-jitter-backoff.js";

export interface RetryPolicyConfig {
  maxRetries: number;
  backoff?: BackoffStrategy;
  retryableErrors?: string[];
}

export class RetryPolicy {
  readonly maxRetries: number;
  readonly backoff: BackoffStrategy;
  private readonly retryableErrors?: Set<string>;

  constructor(config: RetryPolicyConfig) {
    this.maxRetries = config.maxRetries;
    this.backoff = config.backoff ?? new ExponentialJitterBackoff(1000, 30000);
    this.retryableErrors = config.retryableErrors ? new Set(config.retryableErrors) : undefined;
  }

  shouldRetry(attempt: number, error: Error): boolean {
    if (attempt >= this.maxRetries) return false;
    if (this.retryableErrors && !this.retryableErrors.has(error.name)) return false;
    return true;
  }

  getDelay(attempt: number): number {
    return this.backoff.calculate(attempt);
  }
}
