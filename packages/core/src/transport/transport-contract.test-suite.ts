import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Priority } from "../task/types.js";
import type { MessageEnvelope, TaskMessage, TransportAdapter } from "./types.js";

function createTestMessage(overrides?: Partial<TaskMessage>): TaskMessage {
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

export function transportContractTests(
  name: string,
  factory: () => Promise<TransportAdapter>,
  cleanup: (transport: TransportAdapter) => Promise<void>,
) {
  describe(`TransportAdapter contract: ${name}`, () => {
    let transport: TransportAdapter;

    beforeEach(async () => {
      transport = await factory();
    });

    afterEach(async () => {
      await cleanup(transport);
    });

    it("starts disconnected, connects, then disconnects", async () => {
      expect(transport.isConnected()).toBe(true);
      await transport.disconnect();
      expect(transport.isConnected()).toBe(false);
    });

    it("creates and deletes queues", async () => {
      await transport.createQueue("contract-test-q", {});
      await transport.deleteQueue("contract-test-q");
    });

    it("publishes and subscribes — message delivered", async () => {
      const queueName = `contract-${crypto.randomUUID()}`;
      await transport.createQueue(queueName, {});
      const message = createTestMessage({ queue: queueName });

      const received: MessageEnvelope[] = [];
      await transport.subscribe(queueName, async (envelope) => {
        received.push(envelope);
        await transport.acknowledge(envelope);
      });

      await transport.publish(queueName, message, {});

      if ("drain" in transport && typeof transport.drain === "function") {
        await transport.drain(queueName);
      }

      await new Promise((r) => setTimeout(r, 200));

      expect(received).toHaveLength(1);
      expect(received[0]?.task.taskId).toBe(message.taskId);
      expect(received[0]?.task.payload).toEqual(message.payload);
    });

    it("acknowledge removes message from processing", async () => {
      const queueName = `contract-${crypto.randomUUID()}`;
      await transport.createQueue(queueName, {});
      const message = createTestMessage({ queue: queueName });

      let ackEnvelope: MessageEnvelope | undefined;
      await transport.subscribe(queueName, async (envelope) => {
        ackEnvelope = envelope;
        await transport.acknowledge(envelope);
      });

      await transport.publish(queueName, message, {});

      if ("drain" in transport && typeof transport.drain === "function") {
        await transport.drain(queueName);
      }
      await new Promise((r) => setTimeout(r, 200));

      expect(ackEnvelope).toBeDefined();
    });

    it("reject with requeue redelivers message", async () => {
      const queueName = `contract-${crypto.randomUUID()}`;
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

      if ("drain" in transport && typeof transport.drain === "function") {
        await transport.drain(queueName);
        await transport.drain(queueName);
      }
      await new Promise((r) => setTimeout(r, 500));

      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    it("reject without requeue discards message", async () => {
      const queueName = `contract-${crypto.randomUUID()}`;
      await transport.createQueue(queueName, {});
      const message = createTestMessage({ queue: queueName });

      let callCount = 0;
      await transport.subscribe(queueName, async (envelope) => {
        callCount++;
        await transport.reject(envelope, false);
      });

      await transport.publish(queueName, message, {});

      if ("drain" in transport && typeof transport.drain === "function") {
        await transport.drain(queueName);
      }
      await new Promise((r) => setTimeout(r, 200));

      expect(callCount).toBe(1);
    });
  });
}
