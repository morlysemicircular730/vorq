import { VorqError } from "./vorq-error.js";

export class TransportError extends VorqError {
  readonly code = "TRANSPORT_ERROR";
}
