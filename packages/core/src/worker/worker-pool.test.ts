import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../events/event-bus.js";
import { ConsoleLogger } from "../logging/console-logger.js";
import { FixedBackoff } from "../retry/fixed-backoff.js";
import { RetryPolicy } from "../retry/retry-policy.js";
import { Priority } from "../task/types.js";
import { InMemoryTransport } from "../transport/in-memory-transport.js";
import type { TaskMessage } from "../transport/types.js";
import type { TaskContext, TaskHandler } from "./types.js";
import { WorkerPool } from "./worker-pool.js";

function createTaskMessage(overrides?: Partial<TaskMessage>): TaskMessage {
  return {
    taskId: crypto.randomUUID(),
    taskName: "test-task",
    queue: "test-queue",
    payload: { data: "test" },
    attempt: 1,
    priority: Priority.MEDIUM,
    delay: 0,
    maxRetries: 3,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("WorkerPool", () => {
  let transport: InMemoryTransport;
  let eventBus: EventBus;
  let logger: ConsoleLogger;
  let retryPolicy: RetryPolicy;

  beforeEach(async () => {
    logger = new ConsoleLogger();
    transport = new InMemoryTransport();
    eventBus = new EventBus(logger);
    retryPolicy = new RetryPolicy({
      maxRetries: 3,
      backoff: new FixedBackoff(100),
    });
    await transport.connect();
    await transport.createQueue("test-queue", {});
  });

  it("calls handler with correct TaskContext when message received", async () => {
    const handlerFn = vi.fn<TaskHandler>().mockResolvedValue("ok");
    const pool = new WorkerPool("test-queue", handlerFn, transport, eventBus, logger, retryPolicy);

    const msg = createTaskMessage({ payload: { x: 42 } });
    await transport.publish("test-queue", msg, {});

    await pool.start();
    await transport.drain("test-queue");
    await pool.stop();

    expect(handlerFn).toHaveBeenCalledOnce();
    const ctx = handlerFn.mock.calls[0][0];
    expect(ctx.id).toBe(msg.taskId);
    expect(ctx.name).toBe("test-task");
    expect(ctx.payload).toEqual({ x: 42 });
    expect(ctx.attempt).toBe(1);
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
  });

  it("acknowledges on successful handler completion", async () => {
    const handlerFn = vi.fn<TaskHandler>().mockResolvedValue("result");
    const pool = new WorkerPool("test-queue", handlerFn, transport, eventBus, logger, retryPolicy);

    const completedEvents: unknown[] = [];
    eventBus.on("task.completed", (data) => {
      completedEvents.push(data);
    });

    const msg = createTaskMessage();
    await transport.publish("test-queue", msg, {});

    await pool.start();
    await transport.drain("test-queue");
    await pool.stop();

    expect(completedEvents).toHaveLength(1);
    const event = completedEvents[0] as { taskId: string; duration: number };
    expect(event.taskId).toBe(msg.taskId);
    expect(event.duration).toBeGreaterThanOrEqual(0);
  });

  it("respects concurrency via semaphore", async () => {
    let maxConcurrent = 0;
    let current = 0;

    const handlerFn = vi.fn<TaskHandler>(async () => {
      current++;
      if (current > maxConcurrent) maxConcurrent = current;
      await new Promise((r) => setTimeout(r, 50));
      current--;
      return "ok";
    });

    const pool = new WorkerPool("test-queue", handlerFn, transport, eventBus, logger, retryPolicy, {
      concurrency: 2,
    });

    for (let i = 0; i < 5; i++) {
      await transport.publish("test-queue", createTaskMessage(), {});
    }

    await pool.start();
    await transport.drain("test-queue");

    await vi.waitFor(() => {
      expect(handlerFn).toHaveBeenCalledTimes(5);
    });

    await pool.stop();
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("on error with retries remaining: emits task.failed, task.retrying, republishes", async () => {
    const error = new Error("boom");
    const handlerFn = vi.fn<TaskHandler>().mockRejectedValue(error);
    const pool = new WorkerPool("test-queue", handlerFn, transport, eventBus, logger, retryPolicy);

    const failedEvents: unknown[] = [];
    const retryingEvents: unknown[] = [];
    eventBus.on("task.failed", (data) => failedEvents.push(data));
    eventBus.on("task.retrying", (data) => retryingEvents.push(data));

    const msg = createTaskMessage({ attempt: 1, maxRetries: 3 });
    await transport.publish("test-queue", msg, {});

    await pool.start();
    await transport.drain("test-queue");
    await pool.stop();

    expect(failedEvents).toHaveLength(1);
    expect(retryingEvents).toHaveLength(1);
    const retryEvent = retryingEvents[0] as { taskId: string; attempt: number; nextDelay: number };
    expect(retryEvent.taskId).toBe(msg.taskId);
    expect(retryEvent.attempt).toBe(2);
    expect(retryEvent.nextDelay).toBe(100);

    const republished = transport.getPublished("test-queue");
    expect(republished.length).toBeGreaterThanOrEqual(1);
    const retryMsg = republished.find((e) => e.task.taskId === msg.taskId);
    expect(retryMsg).toBeDefined();
    expect(retryMsg?.task.attempt).toBe(2);
  });

  it("on error with retries exhausted: emits task.failed, task.deadLettered, publishes to dlq", async () => {
    const error = new Error("fatal");
    const handlerFn = vi.fn<TaskHandler>().mockRejectedValue(error);
    const pool = new WorkerPool("test-queue", handlerFn, transport, eventBus, logger, retryPolicy);

    const failedEvents: unknown[] = [];
    const deadLetteredEvents: unknown[] = [];
    eventBus.on("task.failed", (data) => failedEvents.push(data));
    eventBus.on("task.deadLettered", (data) => deadLetteredEvents.push(data));

    await transport.createQueue("dlq:test-queue", {});
    const msg = createTaskMessage({ attempt: 3, maxRetries: 3 });
    await transport.publish("test-queue", msg, {});

    await pool.start();
    await transport.drain("test-queue");
    await pool.stop();

    expect(failedEvents).toHaveLength(1);
    expect(deadLetteredEvents).toHaveLength(1);
    const dlEvent = deadLetteredEvents[0] as { taskId: string; attempts: number };
    expect(dlEvent.taskId).toBe(msg.taskId);
    expect(dlEvent.attempts).toBe(3);

    const dlq = transport.getPublished("dlq:test-queue");
    expect(dlq.length).toBe(1);
    expect(dlq[0].task.taskId).toBe(msg.taskId);
  });

  it("TaskContext.progress() emits task.progress event", async () => {
    const progressEvents: unknown[] = [];
    eventBus.on("task.progress", (data) => progressEvents.push(data));

    const handlerFn = vi.fn<TaskHandler>(async (ctx: TaskContext) => {
      await ctx.progress(50);
      await ctx.progress(100);
      return "done";
    });

    const pool = new WorkerPool("test-queue", handlerFn, transport, eventBus, logger, retryPolicy);

    const msg = createTaskMessage();
    await transport.publish("test-queue", msg, {});

    await pool.start();
    await transport.drain("test-queue");
    await pool.stop();

    expect(progressEvents).toHaveLength(2);
    expect(progressEvents[0]).toEqual({
      taskId: msg.taskId,
      queue: "test-queue",
      percent: 50,
    });
    expect(progressEvents[1]).toEqual({
      taskId: msg.taskId,
      queue: "test-queue",
      percent: 100,
    });
  });

  it("TaskContext.log() delegates to logger", async () => {
    const infoSpy = vi.spyOn(logger, "info");

    const handlerFn = vi.fn<TaskHandler>(async (ctx: TaskContext) => {
      ctx.log("hello from task");
      return "ok";
    });

    const pool = new WorkerPool("test-queue", handlerFn, transport, eventBus, logger, retryPolicy);

    const msg = createTaskMessage();
    await transport.publish("test-queue", msg, {});

    await pool.start();
    await transport.drain("test-queue");
    await pool.stop();

    expect(infoSpy).toHaveBeenCalledWith(
      "hello from task",
      expect.objectContaining({ taskId: msg.taskId }),
    );
  });

  it("pause() / resume() / isRunning() state management", async () => {
    const handlerFn = vi.fn<TaskHandler>().mockResolvedValue("ok");
    const pool = new WorkerPool("test-queue", handlerFn, transport, eventBus, logger, retryPolicy);

    expect(pool.isRunning()).toBe(false);

    await pool.start();
    expect(pool.isRunning()).toBe(true);

    pool.pause();
    expect(pool.isRunning()).toBe(false);

    pool.resume();
    expect(pool.isRunning()).toBe(true);

    await pool.stop();
    expect(pool.isRunning()).toBe(false);
  });

  it("graceful shutdown: completes active task within timeout", async () => {
    let taskStarted = false;
    let taskCompleted = false;

    const handlerFn = vi.fn<TaskHandler>(async () => {
      taskStarted = true;
      await new Promise((r) => setTimeout(r, 100));
      taskCompleted = true;
      return "done";
    });

    const pool = new WorkerPool("test-queue", handlerFn, transport, eventBus, logger, retryPolicy);

    const msg = createTaskMessage();
    await transport.publish("test-queue", msg, {});

    await pool.start();

    const drainPromise = transport.drain("test-queue");
    await vi.waitFor(() => {
      expect(taskStarted).toBe(true);
    });

    await pool.stop(5000);
    await drainPromise;
    expect(taskCompleted).toBe(true);
    expect(pool.isRunning()).toBe(false);
  });

  it("emits task.active event before processing", async () => {
    const activeEvents: unknown[] = [];
    eventBus.on("task.active", (data) => activeEvents.push(data));

    const handlerFn = vi.fn<TaskHandler>().mockResolvedValue("ok");
    const pool = new WorkerPool("test-queue", handlerFn, transport, eventBus, logger, retryPolicy);

    const msg = createTaskMessage({ attempt: 1 });
    await transport.publish("test-queue", msg, {});

    await pool.start();
    await transport.drain("test-queue");
    await pool.stop();

    expect(activeEvents).toHaveLength(1);
    expect(activeEvents[0]).toEqual({
      taskId: msg.taskId,
      queue: "test-queue",
      attempt: 1,
    });
  });

  it("shutdown timeout: aborts unfinished tasks", async () => {
    let taskStarted = false;
    let abortSignaled = false;

    const handlerFn = vi.fn<TaskHandler>(async (ctx: TaskContext) => {
      taskStarted = true;
      ctx.signal.addEventListener("abort", () => {
        abortSignaled = true;
      });
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 10000);
        ctx.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve(undefined);
        });
      });
      if (abortSignaled) throw new Error("aborted");
      return "done";
    });

    const pool = new WorkerPool("test-queue", handlerFn, transport, eventBus, logger, retryPolicy);

    const msg = createTaskMessage();
    await transport.publish("test-queue", msg, {});

    await pool.start();

    const drainPromise = transport.drain("test-queue").catch(() => {});
    await vi.waitFor(() => {
      expect(taskStarted).toBe(true);
    });

    await pool.stop(50);
    await drainPromise;

    expect(abortSignaled).toBe(true);
    expect(pool.isRunning()).toBe(false);
  });

  it("attempt numbering is 1-based", async () => {
    const handlerFn = vi.fn<TaskHandler>().mockRejectedValue(new Error("fail"));
    const pool = new WorkerPool("test-queue", handlerFn, transport, eventBus, logger, retryPolicy);

    const msg = createTaskMessage({ attempt: 1 });
    await transport.publish("test-queue", msg, {});

    await pool.start();
    await transport.drain("test-queue");
    await pool.stop();

    const republished = transport.getPublished("test-queue");
    const retryMsg = republished.find((e) => e.task.taskId === msg.taskId);
    expect(retryMsg?.task.attempt).toBe(2);
  });
});
