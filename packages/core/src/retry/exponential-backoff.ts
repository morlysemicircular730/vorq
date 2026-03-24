import type { BackoffStrategy } from "../task/types.js";

export class ExponentialBackoff implements BackoffStrategy {
  constructor(
    private readonly base: number,
    private readonly maxDelay: number,
  ) {}

  calculate(attempt: number): number {
    const delay = this.base * 2 ** (attempt - 1);
    return Math.min(delay, this.maxDelay);
  }
}
