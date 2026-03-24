import { VorqError } from "./vorq-error.js";

export class QueueNotFoundError extends VorqError {
  readonly code = "QUEUE_NOT_FOUND";

  constructor(queueName: string) {
    super(`Queue not found: ${queueName}`);
  }
}
