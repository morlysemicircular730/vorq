import type { EventBus } from "../events/event-bus.js";
import type { VorqLogger } from "../logging/types.js";
import type { RetryPolicy } from "../retry/retry-policy.js";
import type { MessageEnvelope, TransportAdapter } from "../transport/types.js";
import { Semaphore } from "./semaphore.js";
import {
  DEFAULT_WORKER_OPTIONS,
  type TaskContext,
  type TaskHandler,
  type WorkerHandle,
  type WorkerOptions,
} from "./types.js";

export class WorkerPool implements WorkerHandle {
  private readonly semaphore: Semaphore;
  private readonly options: Required<WorkerOptions>;
  private running = false;
  private readonly abortControllers = new Set<AbortController>();
  private readonly activePromises = new Set<Promise<void>>();
  private readonly activeEnvelopes = new Set<MessageEnvelope>();

  constructor(
    private readonly queueName: string,
    private readonly handler: TaskHandler,
    private readonly transport: TransportAdapter,
    private readonly eventBus: EventBus,
    private readonly logger: VorqLogger,
    private readonly retryPolicy: RetryPolicy,
    options?: Partial<WorkerOptions>,
  ) {
    this.options = { ...DEFAULT_WORKER_OPTIONS, ...options };
    this.semaphore = new Semaphore(this.options.concurrency);
  }

  get lockDuration(): number {
    return this.options.lockDuration;
  }

  async start(): Promise<void> {
    this.running = true;
    await this.transport.subscribe(this.queueName, (envelope) => this.handleMessage(envelope));
  }

  async stop(timeout = 30000): Promise<void> {
    this.running = false;

    const activeWait = Promise.all(this.activePromises);
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, timeout));

    await Promise.race([activeWait, timeoutPromise]);

    for (const controller of this.abortControllers) {
      controller.abort();
    }

    for (const envelope of this.activeEnvelopes) {
      try {
        await this.transport.reject(envelope, true);
      } catch {
        // best effort requeue
      }
    }
    this.activeEnvelopes.clear();
  }

  pause(): void {
    this.running = false;
  }

  resume(): void {
    this.running = true;
  }

  isRunning(): boolean {
    return this.running;
  }

  private async handleMessage(envelope: MessageEnvelope): Promise<void> {
    if (!this.running) return;

    await this.semaphore.acquire();

    const promise = this.processMessage(envelope).finally(() => {
      this.semaphore.release();
      this.activePromises.delete(promise);
    });

    this.activePromises.add(promise);
    await promise;
  }

  private async processMessage(envelope: MessageEnvelope): Promise<void> {
    const { task } = envelope;
    const abortController = new AbortController();
    this.abortControllers.add(abortController);
    this.activeEnvelopes.add(envelope);

    await this.eventBus.emit("task.active", {
      taskId: task.taskId,
      queue: this.queueName,
      attempt: task.attempt,
    });

    const context: TaskContext = {
      id: task.taskId,
      name: task.taskName,
      payload: task.payload,
      attempt: task.attempt,
      signal: abortController.signal,
      progress: async (percent: number) => {
        await this.eventBus.emit("task.progress", {
          taskId: task.taskId,
          queue: this.queueName,
          percent,
        });
      },
      log: (message: string) => {
        this.logger.info(message, { taskId: task.taskId });
      },
    };

    const startTime = Date.now();

    try {
      const result = await this.handler(context);
      await this.transport.acknowledge(envelope);
      await this.eventBus.emit("task.completed", {
        taskId: task.taskId,
        queue: this.queueName,
        result,
        duration: Date.now() - startTime,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      await this.eventBus.emit("task.failed", {
        taskId: task.taskId,
        queue: this.queueName,
        error: err,
        attempt: task.attempt,
      });

      if (this.retryPolicy.shouldRetry(task.attempt, err)) {
        const nextAttempt = task.attempt + 1;
        const nextDelay = this.retryPolicy.getDelay(nextAttempt);

        await this.eventBus.emit("task.retrying", {
          taskId: task.taskId,
          queue: this.queueName,
          attempt: nextAttempt,
          nextDelay,
        });

        await this.transport.publish(
          this.queueName,
          { ...task, attempt: nextAttempt, delay: nextDelay },
          { delay: nextDelay },
        );
      } else {
        await this.eventBus.emit("task.deadLettered", {
          taskId: task.taskId,
          queue: this.queueName,
          error: err,
          attempts: task.attempt,
        });

        await this.transport.publish(`dlq:${this.queueName}`, task, {});
      }
    } finally {
      this.abortControllers.delete(abortController);
      this.activeEnvelopes.delete(envelope);
    }
  }
}
