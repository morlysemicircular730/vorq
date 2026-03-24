import { VorqError } from "./vorq-error.js";

export class CyclicDependencyError extends VorqError {
  readonly code = "CYCLIC_DEPENDENCY";

  constructor(
    message: string,
    readonly path: string[],
  ) {
    super(message);
  }
}
