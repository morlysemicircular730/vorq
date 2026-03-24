import type { BackoffStrategy } from "../task/types.js";

export class FixedBackoff implements BackoffStrategy {
  constructor(private readonly delay: number) {}

  calculate(_attempt: number): number {
    return this.delay;
  }
}
