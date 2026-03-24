import { Priority } from "@vorq/core";
import type { MessageEnvelope, TaskMessage, TransportAdapter } from "@vorq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { transportContractTests } from "../../core/src/transport/transport-contract.test-suite.js";
import { RedisTransport } from "./redis-transport.js";

const TEST_PREFIX = `vorq-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function createTestMessage(overrides: Partial<TaskMessage> = {}): TaskMessage {
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

function createTransport(): RedisTransport {
  return new RedisTransport({
    host: "localhost",
    port: 6379,
    keyPrefix: TEST_PREFIX,
    pollInterval: 20,
    delayedPollInterval: 100,
  });
}

transportContractTests(
  "RedisTransport",
  async () => {
    const t = createTransport();
    await t.connect();
    return t as TransportAdapter;
  },
  async (t) => {
    const redis = t as RedisTransport;
    if (redis.isConnected()) {
      await redis.cleanup();
      await redis.disconnect();
    }
  },
);

describe("RedisTransport", () => {
  let transport: RedisTransport;

  beforeEach(async () => {
    transport = createTransport();
    await transport.connect();
  });

  afterEach(async () => {
    if (transport.isConnected()) {
      await transport.cleanup();
      await transport.disconnect();
    }
  });

  it("isConnected returns true after connect and false after disconnect", async () => {
    expect(transport.isConnected()).toBe(true);
    await transport.disconnect();
    expect(transport.isConnected()).toBe(false);
  });

  it("creates and deletes queues without error", async () => {
    await transport.createQueue("redis-test-q", {});
    await transport.deleteQueue("redis-test-q");
  });

  it("publishes and consumes a message", async () => {
    const queueName = `test-${crypto.randomUUID()}`;
    await transport.createQueue(queueName, {});
    const message = createTestMessage({ queue: queueName });

    const received: MessageEnvelope[] = [];
    await transport.subscribe(queueName, async (envelope) => {
      received.push(envelope);
      await transport.acknowledge(envelope);
    });

    await transport.publish(queueName, message, {});
    await new Promise((r) => setTimeout(r, 300));

    expect(received).toHaveLength(1);
    expect(received[0]?.task.taskId).toBe(message.taskId);
    expect(received[0]?.task.payload).toEqual(message.payload);
  });

  describe("priority ordering", () => {
    it("delivers higher priority messages first", async () => {
      const queueName = `priority-${crypto.randomUUID()}`;
      await transport.createQueue(queueName, {});

      const low = createTestMessage({ queue: queueName, taskId: "low", priority: Priority.LOW });
      const critical = createTestMessage({
        queue: queueName,
        taskId: "critical",
        priority: Priority.CRITICAL,
      });
      const high = createTestMessage({
        queue: queueName,
        taskId: "high",
        priority: Priority.HIGH,
      });

      await transport.publish(queueName, low, { priority: Priority.LOW });
      await transport.publish(queueName, critical, { priority: Priority.CRITICAL });
      await transport.publish(queueName, high, { priority: Priority.HIGH });

      await new Promise((r) => setTimeout(r, 50));

      const ids: string[] = [];
      await transport.subscribe(queueName, async (envelope) => {
        ids.push(envelope.task.taskId);
        await transport.acknowledge(envelope);
      });

      await new Promise((r) => setTimeout(r, 300));

      expect(ids).toEqual(["critical", "high", "low"]);
    });
  });

  describe("delayed tasks", () => {
    it("does not deliver delayed messages immediately", async () => {
      const queueName = `delayed-${crypto.randomUUID()}`;
      await transport.createQueue(queueName, {});

      const message = createTestMessage({ queue: queueName, delay: 2000 });

      const received: MessageEnvelope[] = [];
      await transport.subscribe(queueName, async (envelope) => {
        received.push(envelope);
        await transport.acknowledge(envelope);
      });

      await transport.publish(queueName, message, { delay: 2000 });
      await new Promise((r) => setTimeout(r, 200));

      expect(received).toHaveLength(0);
    });

    it("delivers delayed messages after delay expires", async () => {
      const queueName = `delayed2-${crypto.randomUUID()}`;
      await transport.createQueue(queueName, {});

      const message = createTestMessage({ queue: queueName, delay: 300 });

      const received: MessageEnvelope[] = [];
      await transport.subscribe(queueName, async (envelope) => {
        received.push(envelope);
        await transport.acknowledge(envelope);
      });

      await transport.publish(queueName, message, { delay: 300 });
      await new Promise((r) => setTimeout(r, 800));

      expect(received).toHaveLength(1);
      expect(received[0]?.task.taskId).toBe(message.taskId);
    });
  });

  describe("reject", () => {
    it("requeue redelivers the message", async () => {
      const queueName = `reject-${crypto.randomUUID()}`;
      await transport.createQueue(queueName, {});

      const message = createTestMessage({ queue: queueName });
      let callCount = 0;

      await transport.subscribe(queueName, async (envelope) => {
        callCount++;
        if (callCount === 1) {
          await transport.reject(envelope, true);
        } else {
          await transport.acknowledge(envelope);
        }
      });

      await transport.publish(queueName, message, {});
      await new Promise((r) => setTimeout(r, 500));

      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    it("reject without requeue discards message", async () => {
      const queueName = `reject-discard-${crypto.randomUUID()}`;
      await transport.createQueue(queueName, {});

      const message = createTestMessage({ queue: queueName });
      let callCount = 0;

      await transport.subscribe(queueName, async (envelope) => {
        callCount++;
        await transport.reject(envelope, false);
      });

      await transport.publish(queueName, message, {});
      await new Promise((r) => setTimeout(r, 300));

      expect(callCount).toBe(1);
    });
  });
});
