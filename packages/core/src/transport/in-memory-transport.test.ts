import { beforeEach, describe, expect, it } from "vitest";
import { TransportError } from "../errors/index.js";
import { Priority } from "../task/types.js";
import { InMemoryTransport } from "./in-memory-transport.js";
import type { MessageEnvelope, TaskMessage } from "./types.js";

function createTaskMessage(overrides: Partial<TaskMessage> = {}): TaskMessage {
  return {
    taskId: overrides.taskId ?? `task-${Math.random().toString(36).slice(2, 8)}`,
    taskName: overrides.taskName ?? "test-task",
    queue: overrides.queue ?? "default",
    payload: overrides.payload ?? { foo: "bar" },
    attempt: overrides.attempt ?? 1,
    priority: overrides.priority ?? Priority.MEDIUM,
    delay: overrides.delay ?? 0,
    maxRetries: overrides.maxRetries ?? 3,
    createdAt: overrides.createdAt ?? Date.now(),
  };
}

describe("InMemoryTransport", () => {
  let transport: InMemoryTransport;

  beforeEach(() => {
    transport = new InMemoryTransport();
  });

  describe("connect / disconnect / isConnected", () => {
    it("starts disconnected", () => {
      expect(transport.isConnected()).toBe(false);
    });

    it("is connected after connect()", async () => {
      await transport.connect();
      expect(transport.isConnected()).toBe(true);
    });

    it("is disconnected after disconnect()", async () => {
      await transport.connect();
      await transport.disconnect();
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe("createQueue / deleteQueue", () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it("creates a queue", async () => {
      await transport.createQueue("emails", {});
      const published = transport.getPublished("emails");
      expect(published).toEqual([]);
    });

    it("deletes a queue", async () => {
      await transport.createQueue("emails", {});
      await transport.deleteQueue("emails");
      const published = transport.getPublished("emails");
      expect(published).toEqual([]);
    });
  });

  describe("publish", () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it("stores message in queue", async () => {
      const msg = createTaskMessage({ queue: "jobs" });
      await transport.publish("jobs", msg, {});
      const published = transport.getPublished("jobs");
      expect(published).toHaveLength(1);
      expect(published[0].task).toBe(msg);
      expect(published[0].messageId).toBeDefined();
    });

    it("throws TransportError when disconnected", async () => {
      await transport.disconnect();
      const msg = createTaskMessage();
      await expect(transport.publish("jobs", msg, {})).rejects.toThrow(TransportError);
    });

    it("uses provided messageId from options", async () => {
      const msg = createTaskMessage();
      await transport.publish("jobs", msg, { messageId: "custom-id" });
      const published = transport.getPublished("jobs");
      expect(published[0].messageId).toBe("custom-id");
    });
  });

  describe("getPublished", () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it("returns all messages in queue", async () => {
      const msg1 = createTaskMessage();
      const msg2 = createTaskMessage();
      await transport.publish("q", msg1, {});
      await transport.publish("q", msg2, {});
      const published = transport.getPublished("q");
      expect(published).toHaveLength(2);
      expect(published[0].task).toBe(msg1);
      expect(published[1].task).toBe(msg2);
    });

    it("returns empty array for non-existent queue", () => {
      expect(transport.getPublished("nope")).toEqual([]);
    });
  });

  describe("subscribe + drain", () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it("delivers messages to handler", async () => {
      const msg = createTaskMessage();
      await transport.publish("q", msg, {});

      const delivered: MessageEnvelope[] = [];
      await transport.subscribe("q", async (envelope) => {
        delivered.push(envelope);
      });

      await transport.drain("q");
      expect(delivered).toHaveLength(1);
      expect(delivered[0].task).toBe(msg);
    });

    it("delivers messages in order", async () => {
      const msg1 = createTaskMessage({ taskId: "first" });
      const msg2 = createTaskMessage({ taskId: "second" });
      await transport.publish("q", msg1, {});
      await transport.publish("q", msg2, {});

      const ids: string[] = [];
      await transport.subscribe("q", async (envelope) => {
        ids.push(envelope.task.taskId);
      });

      await transport.drain("q");
      expect(ids).toEqual(["first", "second"]);
    });

    it("queue is empty after drain", async () => {
      await transport.publish("q", createTaskMessage(), {});
      await transport.subscribe("q", async () => {});
      await transport.drain("q");
      expect(transport.getPublished("q")).toHaveLength(0);
    });
  });

  describe("acknowledge", () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it("removes message from processing", async () => {
      const msg = createTaskMessage();
      await transport.publish("q", msg, {});

      let captured: MessageEnvelope | undefined;
      await transport.subscribe("q", async (envelope) => {
        captured = envelope;
      });

      await transport.drain("q");
      expect(captured).toBeDefined();
      await expect(transport.acknowledge(captured as MessageEnvelope)).resolves.not.toThrow();
    });
  });

  describe("reject", () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it("requeues message when requeue is true", async () => {
      const msg = createTaskMessage({ taskId: "requeue-me" });
      await transport.publish("q", msg, {});

      let captured: MessageEnvelope | undefined;
      await transport.subscribe("q", async (envelope) => {
        captured = envelope;
      });

      await transport.drain("q");
      expect(transport.getPublished("q")).toHaveLength(0);

      await transport.reject(captured as MessageEnvelope, true);
      const requeued = transport.getPublished("q");
      expect(requeued).toHaveLength(1);
      expect(requeued[0].task.taskId).toBe("requeue-me");
    });

    it("requeues message at front of queue", async () => {
      const msg1 = createTaskMessage({ taskId: "requeue-me" });
      const msg2 = createTaskMessage({ taskId: "other" });
      await transport.publish("q", msg1, {});

      let captured: MessageEnvelope | undefined;
      await transport.subscribe("q", async (envelope) => {
        captured = envelope;
      });

      await transport.drain("q");
      await transport.publish("q", msg2, {});
      await transport.reject(captured as MessageEnvelope, true);

      const messages = transport.getPublished("q");
      expect(messages[0].task.taskId).toBe("requeue-me");
      expect(messages[1].task.taskId).toBe("other");
    });

    it("discards message when requeue is false", async () => {
      const msg = createTaskMessage();
      await transport.publish("q", msg, {});

      let captured: MessageEnvelope | undefined;
      await transport.subscribe("q", async (envelope) => {
        captured = envelope;
      });

      await transport.drain("q");
      await transport.reject(captured as MessageEnvelope, false);
      expect(transport.getPublished("q")).toHaveLength(0);
    });
  });

  describe("priority ordering", () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it("delivers higher priority messages first on drain", async () => {
      const low = createTaskMessage({ taskId: "low", priority: Priority.LOW });
      const critical = createTaskMessage({ taskId: "critical", priority: Priority.CRITICAL });
      const high = createTaskMessage({ taskId: "high", priority: Priority.HIGH });
      const medium = createTaskMessage({ taskId: "medium", priority: Priority.MEDIUM });

      await transport.publish("q", low, {});
      await transport.publish("q", critical, {});
      await transport.publish("q", high, {});
      await transport.publish("q", medium, {});

      const ids: string[] = [];
      await transport.subscribe("q", async (envelope) => {
        ids.push(envelope.task.taskId);
      });

      await transport.drain("q");
      expect(ids).toEqual(["critical", "high", "medium", "low"]);
    });
  });

  describe("delayed messages", () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it("stores delayed messages and delivers them on drain", async () => {
      const msg = createTaskMessage({ delay: 5000 });
      await transport.publish("q", msg, { delay: 5000 });

      const delivered: MessageEnvelope[] = [];
      await transport.subscribe("q", async (envelope) => {
        delivered.push(envelope);
      });

      await transport.drain("q");
      expect(delivered).toHaveLength(1);
      expect(delivered[0].task).toBe(msg);
    });
  });
});

import { transportContractTests } from "./transport-contract.test-suite.js";

transportContractTests(
  "InMemoryTransport",
  async () => {
    const t = new InMemoryTransport();
    await t.connect();
    return t;
  },
  async (t) => {
    if (t.isConnected()) await t.disconnect();
  },
);
