import { describe, expect, it, vi } from "vitest";
import { VorqError } from "../errors/vorq-error.js";
import type { VorqLogger } from "../logging/types.js";
import type { TaskDefinition } from "../task/types.js";
import { CronScheduler } from "./cron-scheduler.js";

function createLogger(): VorqLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createTask(name = "test-task"): TaskDefinition {
  return { name, payload: { key: "value" } };
}

describe("CronScheduler", () => {
  it("register() returns a schedule ID", () => {
    const enqueue = vi.fn();
    const scheduler = new CronScheduler(enqueue, createLogger());

    const id = scheduler.register("my-queue", "* * * * *", createTask());

    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("register() throws VorqError on invalid cron expression", () => {
    const enqueue = vi.fn();
    const scheduler = new CronScheduler(enqueue, createLogger());

    expect(() => scheduler.register("my-queue", "not-a-cron", createTask())).toThrow(VorqError);
  });

  it("getSchedules() lists all registered schedules", () => {
    const enqueue = vi.fn();
    const scheduler = new CronScheduler(enqueue, createLogger());

    scheduler.register("queue-a", "* * * * *", createTask("task-a"));
    scheduler.register("queue-b", "0 * * * *", createTask("task-b"));

    const schedules = scheduler.getSchedules();
    expect(schedules).toHaveLength(2);
    expect(schedules.map((s) => s.queue)).toContain("queue-a");
    expect(schedules.map((s) => s.queue)).toContain("queue-b");
  });

  it("unregister() removes a schedule", () => {
    const enqueue = vi.fn();
    const scheduler = new CronScheduler(enqueue, createLogger());

    const id = scheduler.register("my-queue", "* * * * *", createTask());
    expect(scheduler.getSchedules()).toHaveLength(1);

    scheduler.unregister(id);
    expect(scheduler.getSchedules()).toHaveLength(0);
  });

  it("tick() calls enqueue when nextRun <= now", async () => {
    const enqueue = vi.fn().mockResolvedValue("task-id-1");
    const scheduler = new CronScheduler(enqueue, createLogger());

    scheduler.register("my-queue", "* * * * *", createTask());

    const schedules = scheduler.getSchedules();
    schedules[0].nextRun = new Date(Date.now() - 60_000);

    await scheduler.tick();

    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith("my-queue", createTask());
  });

  it("tick() does not enqueue when nextRun > now", async () => {
    const enqueue = vi.fn();
    const scheduler = new CronScheduler(enqueue, createLogger());

    scheduler.register("my-queue", "* * * * *", createTask());

    const schedules = scheduler.getSchedules();
    schedules[0].nextRun = new Date(Date.now() + 600_000);

    await scheduler.tick();

    expect(enqueue).not.toHaveBeenCalled();
  });

  it("tick() updates lastRun and nextRun after enqueue", async () => {
    const enqueue = vi.fn().mockResolvedValue("task-id-1");
    const scheduler = new CronScheduler(enqueue, createLogger());

    scheduler.register("my-queue", "* * * * *", createTask());

    const schedules = scheduler.getSchedules();
    const oldNextRun = new Date(Date.now() - 60_000);
    schedules[0].nextRun = oldNextRun;

    await scheduler.tick();

    const updated = scheduler.getSchedules()[0];
    expect(updated.lastRun).toBeInstanceOf(Date);
    expect(updated.lastRun?.getTime()).toBeGreaterThanOrEqual(oldNextRun.getTime());
    expect(updated.nextRun.getTime()).toBeGreaterThan(oldNextRun.getTime());
  });

  it("tick() skips when overlap is false and isTaskActive returns true", async () => {
    const enqueue = vi.fn();
    const logger = createLogger();
    const isTaskActive = vi.fn().mockResolvedValue(true);
    const scheduler = new CronScheduler(enqueue, logger, isTaskActive);

    const id = scheduler.register("my-queue", "* * * * *", createTask(), {
      overlap: false,
    });

    const schedules = scheduler.getSchedules();
    schedules[0].nextRun = new Date(Date.now() - 60_000);

    await scheduler.tick();

    expect(isTaskActive).toHaveBeenCalledWith(id);
    expect(enqueue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("tick() enqueues when overlap is true even if isTaskActive returns true", async () => {
    const enqueue = vi.fn().mockResolvedValue("task-id-1");
    const isTaskActive = vi.fn().mockResolvedValue(true);
    const scheduler = new CronScheduler(enqueue, createLogger(), isTaskActive);

    scheduler.register("my-queue", "* * * * *", createTask(), {
      overlap: true,
    });

    const schedules = scheduler.getSchedules();
    schedules[0].nextRun = new Date(Date.now() - 60_000);

    await scheduler.tick();

    expect(isTaskActive).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledOnce();
  });
});
