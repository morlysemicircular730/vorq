import { VorqError } from "./vorq-error.js";

export class TaskNotFoundError extends VorqError {
  readonly code = "TASK_NOT_FOUND";

  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
  }
}
