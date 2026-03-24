import { Priority } from "@vorq/core";
import type { MessageEnvelope, TaskMessage } from "@vorq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { transportContractTests } from "../../core/src/transport/transport-contract.test-suite.js";
import { RabbitMQTransport } from "./rabbitmq-transport.js";

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://localhost";

function createTestMessage(overrides: Partial<TaskMessage> = {}): TaskMessage {
  return {
    taskId: overrides.taskId ?? crypto.randomUUID(),
    taskName: overrides.taskName ?? "test-task",
    queue: overrides.queue ?? "test-queue",
    payload: overrides.payload ?? { data: "test" },
    attempt: overrides.attempt ?? 1,
    priority: overrides.priority ?? Priority.MEDIUM,
    delay: overrides.delay ?? 0,
    maxRetries: overrides.maxRetries ?? 3,
    createdAt: overrides.createdAt ?? Date.now(),
  };
}

function uniqueQueue(): string {
  return `test-${crypto.randomUUID()}`;
}

transportContractTests(
  "RabbitMQTransport",
  async () => {
    const t = new RabbitMQTransport({ url: RABBITMQ_URL });
    await t.connect();
    return t;
  },
  async (t) => {
    if (t.isConnected()) {
      await t.disconnect();
    }
  },
);

describe("RabbitMQTransport", () => {
  let transport: RabbitMQTransport;
  const queuesToCleanup: string[] = [];

  beforeEach(async () => {
    transport = new RabbitMQTransport({ url: RABBITMQ_URL });
    await transport.connect();
  });

  afterEach(async () => {
    for (const q of queuesToCleanup) {
      try {
        await transport.deleteQueue(q);
      } catch {}
      try {
        await transport.deleteQueue(`vorq:delay:${q}`);
      } catch {}
    }
    queuesToCleanup.length = 0;
    if (transport.isConnected()) {
      await transport.disconnect();
    }
  });

  it("connects and disconnects", async () => {
    expect(transport.isConnected()).toBe(true);
    await transport.disconnect();
    expect(transport.isConnected()).toBe(false);
  });

  it("creates and deletes a queue", async () => {
    const q = uniqueQueue();
    queuesToCleanup.push(q);
    await transport.createQueue(q, {});
    await transport.deleteQueue(q);
    queuesToCleanup.pop();
  });

  it("publishes and receives a message", async () => {
    const q = uniqueQueue();
    queuesToCleanup.push(q);
    await transport.createQueue(q, {});

    const message = createTestMessage({ queue: q });
    const received: MessageEnvelope[] = [];

    await transport.subscribe(q, async (envelope) => {
      received.push(envelope);
      await transport.acknowledge(envelope);
    });

    await transport.publish(q, message, {});
    await new Promise((r) => setTimeout(r, 500));

    expect(received).toHaveLength(1);
    expect(received[0].task.taskId).toBe(message.taskId);
    expect(received[0].task.payload).toEqual(message.payload);
  });

  it("rejects with requeue redelivers message", async () => {
    const q = uniqueQueue();
    queuesToCleanup.push(q);
    await transport.createQueue(q, {});

    const message = createTestMessage({ queue: q });
    let callCount = 0;

    await transport.subscribe(q, async (envelope) => {
      callCount++;
      if (callCount === 1) {
        await transport.reject(envelope, true);
      } else {
        await transport.acknowledge(envelope);
      }
    });

    await transport.publish(q, message, {});
    await new Promise((r) => setTimeout(r, 1000));

    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("rejects without requeue discards message", async () => {
    const q = uniqueQueue();
    queuesToCleanup.push(q);
    await transport.createQueue(q, {});

    const message = createTestMessage({ queue: q });
    let callCount = 0;

    await transport.subscribe(q, async (envelope) => {
      callCount++;
      await transport.reject(envelope, false);
    });

    await transport.publish(q, message, {});
    await new Promise((r) => setTimeout(r, 500));

    expect(callCount).toBe(1);
  });

  describe("priority ordering", () => {
    it("delivers higher priority messages first", async () => {
      const q = uniqueQueue();
      queuesToCleanup.push(q);
      await transport.createQueue(q, { maxPriority: 10 });

      const low = createTestMessage({ taskId: "low", queue: q, priority: Priority.LOW });
      const critical = createTestMessage({
        taskId: "critical",
        queue: q,
        priority: Priority.CRITICAL,
      });
      const high = createTestMessage({ taskId: "high", queue: q, priority: Priority.HIGH });
      const medium = createTestMessage({ taskId: "medium", queue: q, priority: Priority.MEDIUM });

      await transport.publish(q, low, { priority: Priority.LOW });
      await transport.publish(q, critical, { priority: Priority.CRITICAL });
      await transport.publish(q, high, { priority: Priority.HIGH });
      await transport.publish(q, medium, { priority: Priority.MEDIUM });

      await new Promise((r) => setTimeout(r, 200));

      const ids: string[] = [];
      await transport.subscribe(q, async (envelope) => {
        ids.push(envelope.task.taskId);
        await transport.acknowledge(envelope);
      });

      await new Promise((r) => setTimeout(r, 1000));

      expect(ids).toEqual(["critical", "high", "medium", "low"]);
    });
  });

  describe("delayed messages", () => {
    it("delivers message after delay via dead-letter exchange", async () => {
      const q = uniqueQueue();
      queuesToCleanup.push(q);
      await transport.createQueue(q, {});

      const message = createTestMessage({ queue: q, delay: 1000 });
      const received: MessageEnvelope[] = [];

      await transport.subscribe(q, async (envelope) => {
        received.push(envelope);
        await transport.acknowledge(envelope);
      });

      const publishedAt = Date.now();
      await transport.publish(q, message, { delay: 1000 });

      await new Promise((r) => setTimeout(r, 500));
      expect(received).toHaveLength(0);

      await new Promise((r) => setTimeout(r, 1500));
      expect(received).toHaveLength(1);
      expect(received[0].task.taskId).toBe(message.taskId);

      const deliveredAt = received[0].receivedAt;
      expect(deliveredAt - publishedAt).toBeGreaterThanOrEqual(900);
    }, 10000);
  });

  describe("prefetch", () => {
    it("respects prefetch count", async () => {
      const prefetchTransport = new RabbitMQTransport({
        url: RABBITMQ_URL,
        prefetch: 2,
      });
      await prefetchTransport.connect();

      const q = uniqueQueue();
      queuesToCleanup.push(q);
      await prefetchTransport.createQueue(q, {});

      const msg1 = createTestMessage({ taskId: "msg1", queue: q });
      const msg2 = createTestMessage({ taskId: "msg2", queue: q });
      const msg3 = createTestMessage({ taskId: "msg3", queue: q });

      await prefetchTransport.publish(q, msg1, {});
      await prefetchTransport.publish(q, msg2, {});
      await prefetchTransport.publish(q, msg3, {});

      const inFlight: string[] = [];
      let maxInFlight = 0;
      const envelopes: MessageEnvelope[] = [];

      await prefetchTransport.subscribe(q, async (envelope) => {
        inFlight.push(envelope.task.taskId);
        maxInFlight = Math.max(maxInFlight, inFlight.length);
        envelopes.push(envelope);
        await new Promise((r) => setTimeout(r, 200));
        inFlight.splice(inFlight.indexOf(envelope.task.taskId), 1);
        await prefetchTransport.acknowledge(envelope);
      });

      await new Promise((r) => setTimeout(r, 2000));

      expect(envelopes).toHaveLength(3);
      expect(maxInFlight).toBeLessThanOrEqual(2);

      await prefetchTransport.deleteQueue(q);
      queuesToCleanup.pop();
      await prefetchTransport.disconnect();
    }, 10000);
  });
});
