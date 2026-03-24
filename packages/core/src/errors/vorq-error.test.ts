import { describe, expect, it } from "vitest";
import {
  CyclicDependencyError,
  QueueNotFoundError,
  ShutdownError,
  TaskNotFoundError,
  TaskTimeoutError,
  TransportError,
  VorqError,
} from "./index.js";

describe("VorqError hierarchy", () => {
  it("all errors extend VorqError", () => {
    const errors = [
      new TransportError("connection failed"),
      new TaskTimeoutError("task timed out", "task-1"),
      new CyclicDependencyError("cycle detected", ["a", "b", "a"]),
      new QueueNotFoundError("queue-1"),
      new TaskNotFoundError("task-1"),
      new ShutdownError("shutting down"),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(VorqError);
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBeDefined();
      expect(error.message).toBeDefined();
    }
  });

  it("TransportError has code TRANSPORT_ERROR", () => {
    const error = new TransportError("connection lost");
    expect(error.code).toBe("TRANSPORT_ERROR");
    expect(error.message).toBe("connection lost");
  });

  it("TaskTimeoutError includes taskId", () => {
    const error = new TaskTimeoutError("timeout", "task-123");
    expect(error.code).toBe("TASK_TIMEOUT");
    expect(error.taskId).toBe("task-123");
  });

  it("CyclicDependencyError includes cycle path", () => {
    const error = new CyclicDependencyError("cycle", ["a", "b", "a"]);
    expect(error.code).toBe("CYCLIC_DEPENDENCY");
    expect(error.path).toEqual(["a", "b", "a"]);
  });

  it("QueueNotFoundError includes queue name", () => {
    const error = new QueueNotFoundError("emails");
    expect(error.code).toBe("QUEUE_NOT_FOUND");
    expect(error.message).toContain("emails");
  });

  it("TaskNotFoundError includes task id", () => {
    const error = new TaskNotFoundError("task-1");
    expect(error.code).toBe("TASK_NOT_FOUND");
    expect(error.message).toContain("task-1");
  });

  it("ShutdownError has code SHUTDOWN", () => {
    const error = new ShutdownError("shutting down");
    expect(error.code).toBe("SHUTDOWN");
  });
});
