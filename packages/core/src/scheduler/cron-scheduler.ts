import { CronExpressionParser } from "cron-parser";
import { VorqError } from "../errors/vorq-error.js";
import type { VorqLogger } from "../logging/types.js";
import type { TaskDefinition } from "../task/types.js";
import type { ScheduleEntry, ScheduleOptions } from "./types.js";

class InvalidCronError extends VorqError {
  readonly code = "INVALID_CRON_EXPRESSION";

  constructor(expression: string, reason: string) {
    super(`Invalid cron expression "${expression}": ${reason}`);
  }
}

export class CronScheduler {
  private readonly schedules = new Map<string, ScheduleEntry>();
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly enqueue: (queue: string, task: TaskDefinition) => Promise<string>,
    private readonly logger: VorqLogger,
    private readonly isTaskActive?: (scheduleId: string) => Promise<boolean>,
  ) {}

  register(
    queue: string,
    cronExpression: string,
    task: TaskDefinition,
    options?: ScheduleOptions,
  ): string {
    let nextRun: Date;
    try {
      const expr = CronExpressionParser.parse(cronExpression);
      nextRun = expr.next().toDate();
    } catch (error) {
      throw new InvalidCronError(cronExpression, (error as Error).message);
    }

    const id = crypto.randomUUID();
    const entry: ScheduleEntry = {
      id,
      queue,
      cron: cronExpression,
      task,
      options: {
        overlap: options?.overlap ?? true,
      },
      lastRun: null,
      nextRun,
    };

    this.schedules.set(id, entry);
    return id;
  }

  unregister(scheduleId: string): void {
    this.schedules.delete(scheduleId);
  }

  getSchedules(): ScheduleEntry[] {
    return Array.from(this.schedules.values());
  }

  async tick(): Promise<void> {
    const now = new Date();
    for (const entry of this.schedules.values()) {
      if (entry.nextRun > now) {
        continue;
      }

      if (!entry.options.overlap && this.isTaskActive) {
        const active = await this.isTaskActive(entry.id);
        if (active) {
          this.logger.warn("Skipping scheduled task due to active overlap", {
            scheduleId: entry.id,
            queue: entry.queue,
            taskName: entry.task.name,
          });
          continue;
        }
      }

      await this.enqueue(entry.queue, entry.task);
      entry.lastRun = new Date();
      const expr = CronExpressionParser.parse(entry.cron);
      entry.nextRun = expr.next().toDate();
    }
  }

  start(): void {
    this.intervalId = setInterval(() => this.tick(), 30_000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
