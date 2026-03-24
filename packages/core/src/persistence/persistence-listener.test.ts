import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../events/event-bus.js";
import { ConsoleLogger } from "../logging/console-logger.js";
import type { TaskRecord } from "../task/types.js";
import { TaskStatus } from "../task/types.js";
import { PersistenceListener } from "./persistence-listener.js";
import type { StorageAdapter } from "./types.js";

function makeMockStorage(): StorageAdapter {
  return {
    saveTask: vi.fn<(task: TaskRecord) => Promise<void>>().mockResolvedValue(undefined),
    updateTask: vi
      .fn<(id: string, update: Partial<TaskRecord>) => Promise<void>>()
      .mockResolvedValue(undefined),
    getTask: vi.fn<(id: string) => Promise<TaskRecord | null>>().mockResolvedValue(null),
    queryTasks: vi.fn().mockResolvedValue([]),
    getMetrics: vi.fn().mockResolvedValue({
      pending: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      avgDuration: 0,
      throughput: 0,
    }),
  };
}

describe("PersistenceListener", () => {
  it("task.enqueued calls saveTask()", async () => {
    const storage = makeMockStorage();
    const logger = new ConsoleLogger();
    const bus = new EventBus(logger);
    const listener = new PersistenceListener(storage, bus, logger);
    listener.register();

    await bus.emit("task.enqueued", { taskId: "t1", queue: "q1" });

    expect(storage.saveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "t1",
        queue: "q1",
        status: TaskStatus.QUEUED,
      }),
    );
  });

  it("task.active calls updateTask() with ACTIVE status and startedAt", async () => {
    const storage = makeMockStorage();
    const logger = new ConsoleLogger();
    const bus = new EventBus(logger);
    const listener = new PersistenceListener(storage, bus, logger);
    listener.register();

    await bus.emit("task.active", { taskId: "t1", queue: "q1", attempt: 1 });

    expect(storage.updateTask).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        status: TaskStatus.ACTIVE,
        attempt: 1,
        startedAt: expect.any(Date),
      }),
    );
  });

  it("task.completed calls updateTask() with COMPLETED, result, and completedAt", async () => {
    const storage = makeMockStorage();
    const logger = new ConsoleLogger();
    const bus = new EventBus(logger);
    const listener = new PersistenceListener(storage, bus, logger);
    listener.register();

    await bus.emit("task.completed", {
      taskId: "t1",
      queue: "q1",
      result: { data: 42 },
      duration: 1500,
    });

    expect(storage.updateTask).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        status: TaskStatus.COMPLETED,
        result: { data: 42 },
        completedAt: expect.any(Date),
      }),
    );
  });

  it("task.failed calls updateTask() with error", async () => {
    const storage = makeMockStorage();
    const logger = new ConsoleLogger();
    const bus = new EventBus(logger);
    const listener = new PersistenceListener(storage, bus, logger);
    listener.register();

    await bus.emit("task.failed", {
      taskId: "t1",
      queue: "q1",
      error: new Error("boom"),
      attempt: 2,
    });

    expect(storage.updateTask).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        status: TaskStatus.FAILED,
        error: "boom",
        attempt: 2,
      }),
    );
  });

  it("task.progress calls updateTask() with progress", async () => {
    const storage = makeMockStorage();
    const logger = new ConsoleLogger();
    const bus = new EventBus(logger);
    const listener = new PersistenceListener(storage, bus, logger);
    listener.register();

    await bus.emit("task.progress", { taskId: "t1", queue: "q1", percent: 75 });

    expect(storage.updateTask).toHaveBeenCalledWith("t1", { progress: 75 });
  });

  it("task.retrying calls updateTask() with RETRYING status", async () => {
    const storage = makeMockStorage();
    const logger = new ConsoleLogger();
    const bus = new EventBus(logger);
    const listener = new PersistenceListener(storage, bus, logger);
    listener.register();

    await bus.emit("task.retrying", {
      taskId: "t1",
      queue: "q1",
      attempt: 3,
      nextDelay: 5000,
    });

    expect(storage.updateTask).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        status: TaskStatus.RETRYING,
        attempt: 3,
      }),
    );
  });

  it("task.deadLettered calls updateTask() with FAILED status", async () => {
    const storage = makeMockStorage();
    const logger = new ConsoleLogger();
    const bus = new EventBus(logger);
    const listener = new PersistenceListener(storage, bus, logger);
    listener.register();

    await bus.emit("task.deadLettered", {
      taskId: "t1",
      queue: "q1",
      error: new Error("too many retries"),
      attempts: 5,
    });

    expect(storage.updateTask).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        status: TaskStatus.FAILED,
        error: "too many retries",
      }),
    );
  });

  it("task.abandoned calls updateTask() with ABANDONED status", async () => {
    const storage = makeMockStorage();
    const logger = new ConsoleLogger();
    const bus = new EventBus(logger);
    const listener = new PersistenceListener(storage, bus, logger);
    listener.register();

    await bus.emit("task.abandoned", {
      taskId: "t1",
      queue: "q1",
      reason: "timed out",
    });

    expect(storage.updateTask).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        status: TaskStatus.ABANDONED,
        error: "timed out",
      }),
    );
  });

  it("storage error does not throw — logs warning", async () => {
    const storage = makeMockStorage();
    const logger = new ConsoleLogger();
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const bus = new EventBus(logger);
    const listener = new PersistenceListener(storage, bus, logger);
    listener.register();

    vi.mocked(storage.saveTask).mockRejectedValue(new Error("db down"));

    await expect(bus.emit("task.enqueued", { taskId: "t1", queue: "q1" })).resolves.not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(
      "Persistence write failed",
      expect.objectContaining({ error: "db down" }),
    );
    warnSpy.mockRestore();
  });

  it("storage throws on update, but processing continues", async () => {
    const storage = makeMockStorage();
    const logger = new ConsoleLogger();
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const bus = new EventBus(logger);
    const listener = new PersistenceListener(storage, bus, logger);
    listener.register();

    vi.mocked(storage.updateTask).mockRejectedValueOnce(new Error("connection lost"));

    await expect(
      bus.emit("task.completed", {
        taskId: "t1",
        queue: "q1",
        result: null,
        duration: 100,
      }),
    ).resolves.not.toThrow();

    expect(warnSpy).toHaveBeenCalled();

    vi.mocked(storage.updateTask).mockResolvedValueOnce(undefined);
    await bus.emit("task.progress", { taskId: "t2", queue: "q1", percent: 50 });
    expect(storage.updateTask).toHaveBeenCalledWith("t2", { progress: 50 });

    warnSpy.mockRestore();
  });
});
