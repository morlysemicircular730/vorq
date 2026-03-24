import type { VorqLogger } from "./types.js";

export class ConsoleLogger implements VorqLogger {
  info(message: string, meta?: Record<string, unknown>): void {
    console.info(`[vorq] ${message}`, meta ?? "");
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(`[vorq] ${message}`, meta ?? "");
  }

  error(message: string, meta?: Record<string, unknown>): void {
    console.error(`[vorq] ${message}`, meta ?? "");
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    console.debug(`[vorq] ${message}`, meta ?? "");
  }
}
