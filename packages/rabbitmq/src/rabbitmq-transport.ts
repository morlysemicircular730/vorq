import type {
  MessageEnvelope,
  MessageHandler,
  PublishOptions,
  QueueOptions,
  TaskMessage,
  TransportAdapter,
} from "@vorq/core";
import amqplib from "amqplib";

export interface RabbitMQTransportOptions {
  url?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  vhost?: string;
  prefetch?: number;
}

export class RabbitMQTransport implements TransportAdapter {
  private connection: amqplib.Connection | null = null;
  private channel: amqplib.Channel | null = null;
  private readonly url: string;
  private readonly prefetch: number;
  private connected = false;
  private rawMessages = new Map<string, amqplib.ConsumeMessage>();
  private createdQueues = new Set<string>();
  private consumerTags = new Map<string, string>();

  constructor(options: RabbitMQTransportOptions = {}) {
    if (options.url) {
      this.url = options.url;
    } else {
      const host = options.host ?? "localhost";
      const port = options.port ?? 5672;
      const username = options.username ?? "guest";
      const password = options.password ?? "guest";
      const vhost = options.vhost ?? "/";
      const encodedVhost = vhost === "/" ? "" : `/${encodeURIComponent(vhost)}`;
      this.url = `amqp://${username}:${password}@${host}:${port}${encodedVhost}`;
    }
    this.prefetch = options.prefetch ?? 1;
  }

  async connect(): Promise<void> {
    this.connection = await amqplib.connect(this.url);
    this.channel = await this.connection.createChannel();
    await this.channel.prefetch(this.prefetch);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    for (const [, tag] of this.consumerTags) {
      try {
        await this.channel?.cancel(tag);
      } catch {}
    }
    this.consumerTags.clear();

    try {
      await this.channel?.close();
    } catch {}
    try {
      await this.connection?.close();
    } catch {}

    this.channel = null;
    this.connection = null;
    this.connected = false;
    this.rawMessages.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async createQueue(name: string, options: QueueOptions): Promise<void> {
    const ch = this.getChannel();

    const args: Record<string, unknown> = {};
    if (options.maxPriority) {
      args["x-max-priority"] = options.maxPriority;
    }
    if (options.deadLetterQueue) {
      args["x-dead-letter-exchange"] = "";
      args["x-dead-letter-routing-key"] = options.deadLetterQueue;
    }
    if (options.messageTtl) {
      args["x-message-ttl"] = options.messageTtl;
    }
    if (options.maxLength) {
      args["x-max-length"] = options.maxLength;
    }

    await ch.assertQueue(name, {
      durable: true,
      arguments: Object.keys(args).length > 0 ? args : undefined,
    });

    this.createdQueues.add(name);
  }

  async deleteQueue(name: string): Promise<void> {
    const ch = this.getChannel();
    await ch.deleteQueue(name);
    this.createdQueues.delete(name);
  }

  async publish(queue: string, message: TaskMessage, options: PublishOptions): Promise<void> {
    const ch = this.getChannel();

    const messageId = options.messageId ?? crypto.randomUUID();
    const content = Buffer.from(JSON.stringify(message));

    const publishOptions: amqplib.Options.Publish = {
      messageId,
      persistent: true,
      contentType: "application/json",
    };

    if (options.priority !== undefined) {
      publishOptions.priority = this.mapPriority(options.priority);
    }

    if (options.delay && options.delay > 0) {
      await this.publishDelayed(ch, queue, content, publishOptions, options.delay);
      return;
    }

    ch.sendToQueue(queue, content, publishOptions);
  }

  async subscribe(queue: string, handler: MessageHandler): Promise<void> {
    const ch = this.getChannel();

    const { consumerTag } = await ch.consume(
      queue,
      async (msg) => {
        if (!msg) return;

        const task: TaskMessage = JSON.parse(msg.content.toString());
        const envelope: MessageEnvelope = {
          messageId: msg.properties.messageId ?? crypto.randomUUID(),
          task,
          receivedAt: Date.now(),
        };

        this.rawMessages.set(envelope.messageId, msg);

        try {
          await handler(envelope);
        } catch {}
      },
      { noAck: false },
    );

    this.consumerTags.set(queue, consumerTag);
  }

  async acknowledge(envelope: MessageEnvelope): Promise<void> {
    const ch = this.getChannel();
    const raw = this.rawMessages.get(envelope.messageId);
    if (raw) {
      ch.ack(raw);
      this.rawMessages.delete(envelope.messageId);
    }
  }

  async reject(envelope: MessageEnvelope, requeue: boolean): Promise<void> {
    const ch = this.getChannel();
    const raw = this.rawMessages.get(envelope.messageId);
    if (raw) {
      ch.nack(raw, false, requeue);
      this.rawMessages.delete(envelope.messageId);
    }
  }

  private async publishDelayed(
    ch: amqplib.Channel,
    targetQueue: string,
    content: Buffer,
    publishOptions: amqplib.Options.Publish,
    delay: number,
  ): Promise<void> {
    const delayQueue = `vorq:delay:${targetQueue}`;

    await ch.assertQueue(delayQueue, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": "",
        "x-dead-letter-routing-key": targetQueue,
      },
    });

    publishOptions.expiration = delay.toString();
    ch.sendToQueue(delayQueue, content, publishOptions);
  }

  private mapPriority(priority: number): number {
    return 10 - priority;
  }

  private getChannel(): amqplib.Channel {
    if (!this.channel) {
      throw new Error("RabbitMQ channel is not available. Call connect() first.");
    }
    return this.channel;
  }
}
