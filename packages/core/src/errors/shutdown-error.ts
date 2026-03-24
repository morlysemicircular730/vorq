import { VorqError } from "./vorq-error.js";

export class ShutdownError extends VorqError {
  readonly code = "SHUTDOWN";
}
