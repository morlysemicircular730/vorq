import { describe, expect, it } from "vitest";
import { Priority, TaskStatus } from "./types.js";

describe("Priority", () => {
  it("CRITICAL < HIGH < MEDIUM < LOW", () => {
    expect(Priority.CRITICAL).toBeLessThan(Priority.HIGH);
    expect(Priority.HIGH).toBeLessThan(Priority.MEDIUM);
    expect(Priority.MEDIUM).toBeLessThan(Priority.LOW);
  });
});

describe("TaskStatus", () => {
  it("contains all expected statuses", () => {
    const statuses = [
      TaskStatus.WAITING,
      TaskStatus.PENDING,
      TaskStatus.QUEUED,
      TaskStatus.ACTIVE,
      TaskStatus.COMPLETED,
      TaskStatus.FAILED,
      TaskStatus.RETRYING,
      TaskStatus.ABANDONED,
    ];
    expect(statuses).toHaveLength(8);
  });
});
