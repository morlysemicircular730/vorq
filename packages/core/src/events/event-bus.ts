import type { VorqLogger } from "../logging/types.js";
import type { VorqEvent, VorqEventListener, VorqEventMap } from "./types.js";

export class EventBus {
  private readonly listeners = new Map<string, Set<VorqEventListener<VorqEvent>>>();

  constructor(private readonly logger: VorqLogger) {}

  on<E extends VorqEvent>(event: E, listener: VorqEventListener<E>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener as VorqEventListener<VorqEvent>);
  }

  off<E extends VorqEvent>(event: E, listener: VorqEventListener<E>): void {
    this.listeners.get(event)?.delete(listener as VorqEventListener<VorqEvent>);
  }

  async emit<E extends VorqEvent>(event: E, data: VorqEventMap[E]): Promise<void> {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return;

    for (const listener of eventListeners) {
      try {
        await listener(data);
      } catch (error) {
        this.logger.error(`EventBus listener error on ${event}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
