import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TaskStatus } from "../task/types.js";
import type { TaskRecord } from "../task/types.js";
import { PrismaStorage } from "./prisma-storage.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://vorq:vorq@localhost:5432/vorq";

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: crypto.randomUUID(),
    queue: "default",
    name: "test-task",
    payload: { key: "value" },
    status: TaskStatus.PENDING,
    priority: 2,
    attempt: 0,
    maxRetries: 3,
    progress: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("PrismaStorage", () => {
  let prisma: PrismaClient;
  let storage: PrismaStorage;

  beforeAll(() => {
    prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
    storage = new PrismaStorage(prisma);
  });

  afterEach(async () => {
    await prisma.taskAttempt.deleteMany();
    await prisma.taskDependency.deleteMany();
    await prisma.task.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("saveTask() inserts a record", async () => {
    const task = makeTask();
    await storage.saveTask(task);

    const found = await prisma.task.findUnique({ where: { id: task.id } });
    expect(found).not.toBeNull();
    expect(found?.name).toBe("test-task");
    expect(found?.queue).toBe("default");
  });

  it("getTask() returns task by ID", async () => {
    const task = makeTask();
    await storage.saveTask(task);

    const found = await storage.getTask(task.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(task.id);
    expect(found?.name).toBe(task.name);
    expect(found?.payload).toEqual({ key: "value" });
    expect(found?.status).toBe(TaskStatus.PENDING);
  });

  it("getTask() returns null for unknown ID", async () => {
    const found = await storage.getTask(crypto.randomUUID());
    expect(found).toBeNull();
  });

  it("updateTask() updates specific fields", async () => {
    const task = makeTask();
    await storage.saveTask(task);

    await storage.updateTask(task.id, {
      status: TaskStatus.ACTIVE,
      startedAt: new Date(),
      attempt: 1,
    });

    const found = await storage.getTask(task.id);
    expect(found?.status).toBe(TaskStatus.ACTIVE);
    expect(found?.startedAt).toBeInstanceOf(Date);
    expect(found?.attempt).toBe(1);
  });

  it("queryTasks() filters by queue", async () => {
    await storage.saveTask(makeTask({ queue: "alpha" }));
    await storage.saveTask(makeTask({ queue: "beta" }));
    await storage.saveTask(makeTask({ queue: "alpha" }));

    const results = await storage.queryTasks({ queue: "alpha" });
    expect(results).toHaveLength(2);
    expect(results.every((t) => t.queue === "alpha")).toBe(true);
  });

  it("queryTasks() filters by single status", async () => {
    await storage.saveTask(makeTask({ status: TaskStatus.PENDING }));
    await storage.saveTask(makeTask({ status: TaskStatus.ACTIVE }));
    await storage.saveTask(makeTask({ status: TaskStatus.PENDING }));

    const results = await storage.queryTasks({ status: TaskStatus.PENDING });
    expect(results).toHaveLength(2);
    expect(results.every((t) => t.status === TaskStatus.PENDING)).toBe(true);
  });

  it("queryTasks() filters by status array", async () => {
    await storage.saveTask(makeTask({ status: TaskStatus.PENDING }));
    await storage.saveTask(makeTask({ status: TaskStatus.ACTIVE }));
    await storage.saveTask(makeTask({ status: TaskStatus.COMPLETED }));

    const results = await storage.queryTasks({
      status: [TaskStatus.PENDING, TaskStatus.ACTIVE],
    });
    expect(results).toHaveLength(2);
  });

  it("queryTasks() pagination with limit and offset", async () => {
    for (let i = 0; i < 5; i++) {
      await storage.saveTask(makeTask({ queue: "paged" }));
    }

    const page1 = await storage.queryTasks({
      queue: "paged",
      limit: 2,
      offset: 0,
    });
    expect(page1).toHaveLength(2);

    const page2 = await storage.queryTasks({
      queue: "paged",
      limit: 2,
      offset: 2,
    });
    expect(page2).toHaveLength(2);

    const page3 = await storage.queryTasks({
      queue: "paged",
      limit: 2,
      offset: 4,
    });
    expect(page3).toHaveLength(1);
  });

  it("queryTasks() ordering", async () => {
    const older = makeTask({
      queue: "ordered",
      createdAt: new Date("2024-01-01"),
    });
    const newer = makeTask({
      queue: "ordered",
      createdAt: new Date("2024-06-01"),
    });
    await storage.saveTask(older);
    await storage.saveTask(newer);

    const asc = await storage.queryTasks({
      queue: "ordered",
      orderBy: "createdAt",
      order: "asc",
    });
    expect(asc[0]?.id).toBe(older.id);

    const desc = await storage.queryTasks({
      queue: "ordered",
      orderBy: "createdAt",
      order: "desc",
    });
    expect(desc[0]?.id).toBe(newer.id);
  });

  it("getMetrics() returns correct counts", async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 30 * 60 * 1000);

    await storage.saveTask(makeTask({ queue: "metrics", status: TaskStatus.PENDING }));
    await storage.saveTask(makeTask({ queue: "metrics", status: TaskStatus.PENDING }));
    await storage.saveTask(makeTask({ queue: "metrics", status: TaskStatus.ACTIVE }));
    await storage.saveTask(
      makeTask({
        queue: "metrics",
        status: TaskStatus.COMPLETED,
        completedAt: oneHourAgo,
        startedAt: new Date(oneHourAgo.getTime() - 5000),
      }),
    );
    await storage.saveTask(makeTask({ queue: "metrics", status: TaskStatus.FAILED }));

    const metrics = await storage.getMetrics("metrics");
    expect(metrics.pending).toBe(2);
    expect(metrics.active).toBe(1);
    expect(metrics.completed).toBe(1);
    expect(metrics.failed).toBe(1);
    expect(metrics.throughput).toBe(1);
    expect(metrics.avgDuration).toBeGreaterThan(0);
  });
});
