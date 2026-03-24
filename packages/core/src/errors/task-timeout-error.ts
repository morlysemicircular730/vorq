import { VorqError } from "./vorq-error.js";

export class TaskTimeoutError extends VorqError {
  readonly code = "TASK_TIMEOUT";

  constructor(
    message: string,
    readonly taskId: string,
  ) {
    super(message);
  }
}
