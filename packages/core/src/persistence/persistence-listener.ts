import type { EventBus } from "../events/event-bus.js";
import type { VorqLogger } from "../logging/types.js";
import { TaskStatus } from "../task/types.js";
import type { StorageAdapter } from "./types.js";

export class PersistenceListener {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly eventBus: EventBus,
    private readonly logger: VorqLogger,
  ) {}

  register(): void {
    this.eventBus.on("task.enqueued", (data) => this.handleSafe(() => this.onEnqueued(data)));
    this.eventBus.on("task.active", (data) => this.handleSafe(() => this.onActive(data)));
    this.eventBus.on("task.completed", (data) => this.handleSafe(() => this.onCompleted(data)));
    this.eventBus.on("task.failed", (data) => this.handleSafe(() => this.onFailed(data)));
    this.eventBus.on("task.progress", (data) => this.handleSafe(() => this.onProgress(data)));
    this.eventBus.on("task.retrying", (data) => this.handleSafe(() => this.onRetrying(data)));
    this.eventBus.on("task.deadLettered", (data) =>
      this.handleSafe(() => this.onDeadLettered(data)),
    );
    this.eventBus.on("task.abandoned", (data) => this.handleSafe(() => this.onAbandoned(data)));
  }

  private async handleSafe(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.warn("Persistence write failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async onEnqueued(data: { taskId: string; queue: string }): Promise<void> {
    await this.storage.saveTask({
      id: data.taskId,
      queue: data.queue,
      name: "",
      payload: {},
      status: TaskStatus.QUEUED,
      priority: 2,
      attempt: 0,
      maxRetries: 3,
      progress: 0,
      createdAt: new Date(),
    });
  }

  private async onActive(data: {
    taskId: string;
    queue: string;
    attempt: number;
  }): Promise<void> {
    await this.storage.updateTask(data.taskId, {
      status: TaskStatus.ACTIVE,
      attempt: data.attempt,
      startedAt: new Date(),
    });
  }

  private async onCompleted(data: {
    taskId: string;
    queue: string;
    result: unknown;
    duration: number;
  }): Promise<void> {
    await this.storage.updateTask(data.taskId, {
      status: TaskStatus.COMPLETED,
      result: data.result,
      completedAt: new Date(),
    });
  }

  private async onFailed(data: {
    taskId: string;
    queue: string;
    error: Error;
    attempt: number;
  }): Promise<void> {
    await this.storage.updateTask(data.taskId, {
      status: TaskStatus.FAILED,
      error: data.error.message,
      attempt: data.attempt,
    });
  }

  private async onProgress(data: {
    taskId: string;
    queue: string;
    percent: number;
  }): Promise<void> {
    await this.storage.updateTask(data.taskId, {
      progress: data.percent,
    });
  }

  private async onRetrying(data: {
    taskId: string;
    queue: string;
    attempt: number;
    nextDelay: number;
  }): Promise<void> {
    await this.storage.updateTask(data.taskId, {
      status: TaskStatus.RETRYING,
      attempt: data.attempt,
    });
  }

  private async onDeadLettered(data: {
    taskId: string;
    queue: string;
    error: Error;
    attempts: number;
  }): Promise<void> {
    await this.storage.updateTask(data.taskId, {
      status: TaskStatus.FAILED,
      error: data.error.message,
    });
  }

  private async onAbandoned(data: {
    taskId: string;
    queue: string;
    reason: string;
  }): Promise<void> {
    await this.storage.updateTask(data.taskId, {
      status: TaskStatus.ABANDONED,
      error: data.reason,
    });
  }
}
