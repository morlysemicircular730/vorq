import type { PrismaClient } from "@prisma/client";
import type { TaskRecord, TaskStatus } from "../task/types.js";
import type { QueueMetrics, StorageAdapter, TaskFilter } from "./types.js";

export class PrismaStorage implements StorageAdapter {
  constructor(private readonly prisma: PrismaClient) {}

  async saveTask(task: TaskRecord): Promise<void> {
    await this.prisma.task.create({
      data: {
        id: task.id,
        queue: task.queue,
        name: task.name,
        // biome-ignore lint/suspicious/noExplicitAny: Prisma Json type requires any
        payload: task.payload as any,
        status: task.status,
        priority: task.priority,
        // biome-ignore lint/suspicious/noExplicitAny: Prisma Json type requires any
        result: task.result as any,
        error: task.error,
        attempt: task.attempt,
        maxRetries: task.maxRetries,
        progress: task.progress,
        scheduleId: task.scheduleId,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
      },
    });
  }

  async updateTask(id: string, update: Partial<TaskRecord>): Promise<void> {
    const data: Record<string, unknown> = {};
    if (update.status !== undefined) data.status = update.status;
    if (update.priority !== undefined) data.priority = update.priority;
    if (update.result !== undefined) data.result = update.result as Record<string, unknown>;
    if (update.error !== undefined) data.error = update.error;
    if (update.attempt !== undefined) data.attempt = update.attempt;
    if (update.maxRetries !== undefined) data.maxRetries = update.maxRetries;
    if (update.progress !== undefined) data.progress = update.progress;
    if (update.startedAt !== undefined) data.startedAt = update.startedAt;
    if (update.completedAt !== undefined) data.completedAt = update.completedAt;
    if (update.scheduleId !== undefined) data.scheduleId = update.scheduleId;

    await this.prisma.task.update({ where: { id }, data });
  }

  async getTask(id: string): Promise<TaskRecord | null> {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) return null;
    return this.mapToRecord(task);
  }

  async queryTasks(filter: TaskFilter): Promise<TaskRecord[]> {
    const where: Record<string, unknown> = {};

    if (filter.queue) {
      where.queue = filter.queue;
    }

    if (filter.status) {
      where.status = Array.isArray(filter.status) ? { in: filter.status } : filter.status;
    }

    if (filter.name) {
      where.name = filter.name;
    }

    if (filter.from || filter.to) {
      const createdAt: Record<string, Date> = {};
      if (filter.from) createdAt.gte = filter.from;
      if (filter.to) createdAt.lte = filter.to;
      where.createdAt = createdAt;
    }

    const orderBy = filter.orderBy
      ? { [filter.orderBy]: filter.order ?? "asc" }
      : { createdAt: "asc" as const };

    const tasks = await this.prisma.task.findMany({
      where,
      orderBy,
      take: filter.limit,
      skip: filter.offset,
    });

    // biome-ignore lint/suspicious/noExplicitAny: Prisma model types
    return tasks.map((t: any) => this.mapToRecord(t));
  }

  async getMetrics(queue?: string): Promise<QueueMetrics> {
    const where = queue ? { queue } : {};

    const counts = await this.prisma.task.groupBy({
      by: ["status"],
      where,
      _count: { status: true },
    });

    const statusCount = (status: string) =>
      // biome-ignore lint/suspicious/noExplicitAny: Prisma groupBy result type
      counts.find((c: any) => c.status === status)?._count.status ?? 0;

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const completedRecent = await this.prisma.task.count({
      where: {
        ...where,
        status: "COMPLETED",
        completedAt: { gte: oneHourAgo },
      },
    });

    const completedWithDuration = await this.prisma.task.findMany({
      where: {
        ...where,
        status: "COMPLETED",
        startedAt: { not: null },
        completedAt: { not: null },
      },
      select: { startedAt: true, completedAt: true },
    });

    let avgDuration = 0;
    if (completedWithDuration.length > 0) {
      // biome-ignore lint/suspicious/noExplicitAny: Prisma select result type
      const total = completedWithDuration.reduce((sum: number, t: any) => {
        const started = t.startedAt as Date;
        const completed = t.completedAt as Date;
        return sum + (completed.getTime() - started.getTime());
      }, 0);
      avgDuration = total / completedWithDuration.length;
    }

    return {
      pending: statusCount("PENDING") + statusCount("QUEUED"),
      active: statusCount("ACTIVE"),
      completed: statusCount("COMPLETED"),
      failed: statusCount("FAILED"),
      delayed: statusCount("WAITING"),
      avgDuration,
      throughput: completedRecent,
    };
  }

  private mapToRecord(task: {
    id: string;
    queue: string;
    name: string;
    payload: unknown;
    status: string;
    priority: number;
    result: unknown;
    error: string | null;
    attempt: number;
    maxRetries: number;
    progress: number;
    scheduleId: string | null;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  }): TaskRecord {
    return {
      id: task.id,
      queue: task.queue,
      name: task.name,
      payload: task.payload,
      status: task.status as TaskStatus,
      priority: task.priority,
      result: task.result ?? undefined,
      error: task.error ?? undefined,
      attempt: task.attempt,
      maxRetries: task.maxRetries,
      progress: task.progress,
      scheduleId: task.scheduleId ?? undefined,
      createdAt: task.createdAt,
      startedAt: task.startedAt ?? undefined,
      completedAt: task.completedAt ?? undefined,
    };
  }
}
