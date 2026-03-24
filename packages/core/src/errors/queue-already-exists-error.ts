import { VorqError } from "./vorq-error.js";

export class QueueAlreadyExistsError extends VorqError {
  readonly code = "QUEUE_ALREADY_EXISTS";

  constructor(queueName: string) {
    super(`Queue already exists: ${queueName}`);
  }
}
