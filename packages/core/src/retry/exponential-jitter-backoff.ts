import type { BackoffStrategy } from "../task/types.js";

export class ExponentialJitterBackoff implements BackoffStrategy {
  constructor(
    private readonly base: number,
    private readonly maxDelay: number,
  ) {}

  calculate(attempt: number): number {
    const exponentialDelay = this.base * 2 ** (attempt - 1);
    const capped = Math.min(exponentialDelay, this.maxDelay);
    return Math.max(1, Math.floor(Math.random() * capped));
  }
}
