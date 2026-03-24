import type {
  MessageEnvelope,
  MessageHandler,
  PublishOptions,
  QueueOptions,
  TaskMessage,
  TransportAdapter,
} from "@vorq/core";
import Redis from "ioredis";

export interface RedisTransportOptions {
  host?: string;
  port?: number;
  url?: string;
  password?: string;
  db?: number;
  keyPrefix?: string;
  pollInterval?: number;
  delayedPollInterval?: number;
}

const PRIORITY_MULTIPLIER = 1e13;

export class RedisTransport implements TransportAdapter {
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private connected = false;
  private readonly options: RedisTransportOptions;
  private readonly keyPrefix: string;
  private handlers = new Map<string, MessageHandler>();
  private pollingTimers = new Map<string, ReturnType<typeof setInterval>>();
  private delayedTimer: ReturnType<typeof setInterval> | null = null;
  private activeQueues = new Set<string>();
  private pollInterval: number;
  private delayedPollInterval: number;

  constructor(options: RedisTransportOptions = {}) {
    this.options = options;
    this.keyPrefix = options.keyPrefix ?? "vorq";
    this.pollInterval = options.pollInterval ?? 50;
    this.delayedPollInterval = options.delayedPollInterval ?? 500;
  }

  private get redis(): Redis {
    if (!this.client) {
      throw new Error("Transport is not connected");
    }
    return this.client;
  }

  private queueKey(name: string): string {
    return `${this.keyPrefix}:queue:${name}`;
  }

  private processingKey(name: string): string {
    return `${this.keyPrefix}:processing:${name}`;
  }

  private delayedKey(name: string): string {
    return `${this.keyPrefix}:delayed:${name}`;
  }

  private metaKey(name: string): string {
    return `${this.keyPrefix}:meta:${name}`;
  }

  private createRedisClient(): Redis {
    if (this.options.url) {
      return new Redis(this.options.url);
    }
    return new Redis({
      host: this.options.host ?? "localhost",
      port: this.options.port ?? 6379,
      password: this.options.password,
      db: this.options.db ?? 0,
      lazyConnect: true,
    });
  }

  async connect(): Promise<void> {
    this.client = this.createRedisClient();
    this.subscriber = this.createRedisClient();
    await this.client.connect();
    await this.subscriber.connect();
    this.connected = true;
    this.startDelayedPoller();
  }

  async disconnect(): Promise<void> {
    this.stopAllPolling();

    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }
    this.connected = false;
    this.handlers.clear();
    this.activeQueues.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async createQueue(name: string, _options: QueueOptions): Promise<void> {
    this.ensureConnected();
    await this.redis.set(this.metaKey(name), JSON.stringify(_options));
  }

  async deleteQueue(name: string): Promise<void> {
    this.ensureConnected();
    this.stopPolling(name);
    this.handlers.delete(name);
    this.activeQueues.delete(name);
    await this.redis.del(
      this.queueKey(name),
      this.processingKey(name),
      this.delayedKey(name),
      this.metaKey(name),
    );
  }

  async publish(queue: string, message: TaskMessage, options: PublishOptions): Promise<void> {
    this.ensureConnected();

    const messageId = options.messageId ?? crypto.randomUUID();
    const envelope: MessageEnvelope = {
      messageId,
      task: message,
      receivedAt: Date.now(),
    };

    const delay = options.delay ?? message.delay ?? 0;

    if (delay > 0) {
      const executeAt = Date.now() + delay;
      await this.redis.zadd(this.delayedKey(queue), executeAt, JSON.stringify(envelope));
    } else {
      const priority = options.priority ?? message.priority ?? 2;
      const score = priority * PRIORITY_MULTIPLIER + Date.now();
      await this.redis.zadd(this.queueKey(queue), score, JSON.stringify(envelope));
    }
  }

  async subscribe(queue: string, handler: MessageHandler): Promise<void> {
    this.ensureConnected();
    this.handlers.set(queue, handler);
    this.activeQueues.add(queue);
    this.startPolling(queue);
  }

  async acknowledge(envelope: MessageEnvelope): Promise<void> {
    this.ensureConnected();
    await this.redis.hdel(this.processingKey(envelope.task.queue), envelope.messageId);
  }

  async reject(envelope: MessageEnvelope, requeue: boolean): Promise<void> {
    this.ensureConnected();
    await this.redis.hdel(this.processingKey(envelope.task.queue), envelope.messageId);

    if (requeue) {
      const priority = envelope.task.priority ?? 2;
      const score = priority * PRIORITY_MULTIPLIER + Date.now();
      await this.redis.zadd(this.queueKey(envelope.task.queue), score, JSON.stringify(envelope));
    }
  }

  async drain(queue: string): Promise<void> {
    await this.pollOnce(queue);
  }

  async cleanup(): Promise<void> {
    this.ensureConnected();
    const keys = await this.redis.keys(`${this.keyPrefix}:*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  private ensureConnected(): void {
    if (!this.connected || !this.client) {
      throw new Error("Transport is not connected");
    }
  }

  private async pollOnce(queue: string): Promise<void> {
    if (!this.connected || !this.client) return;

    const handler = this.handlers.get(queue);
    if (!handler) return;

    const result = await this.client.zpopmin(this.queueKey(queue), 1);
    if (!result || result.length < 2) return;

    const [serialized] = result;
    if (!serialized) return;

    let envelope: MessageEnvelope;
    try {
      envelope = JSON.parse(serialized) as MessageEnvelope;
    } catch {
      return;
    }

    await this.client.hset(this.processingKey(queue), envelope.messageId, serialized);

    await handler(envelope);
  }

  private startPolling(queue: string): void {
    if (this.pollingTimers.has(queue)) return;

    const timer = setInterval(async () => {
      try {
        await this.pollOnce(queue);
      } catch {
        /* polling continues */
      }
    }, this.pollInterval);

    this.pollingTimers.set(queue, timer);
  }

  private stopPolling(queue: string): void {
    const timer = this.pollingTimers.get(queue);
    if (timer) {
      clearInterval(timer);
      this.pollingTimers.delete(queue);
    }
  }

  private stopAllPolling(): void {
    for (const timer of this.pollingTimers.values()) {
      clearInterval(timer);
    }
    this.pollingTimers.clear();

    if (this.delayedTimer) {
      clearInterval(this.delayedTimer);
      this.delayedTimer = null;
    }
  }

  private startDelayedPoller(): void {
    this.delayedTimer = setInterval(async () => {
      try {
        await this.moveReadyDelayedTasks();
      } catch {
        /* polling continues */
      }
    }, this.delayedPollInterval);
  }

  private async moveReadyDelayedTasks(): Promise<void> {
    if (!this.connected || !this.client) return;

    for (const queue of this.activeQueues) {
      const now = Date.now();
      const ready = await this.client.zrangebyscore(this.delayedKey(queue), 0, now);

      if (ready.length === 0) continue;

      const pipeline = this.client.pipeline();
      for (const item of ready) {
        let envelope: MessageEnvelope;
        try {
          envelope = JSON.parse(item) as MessageEnvelope;
        } catch {
          continue;
        }
        const priority = envelope.task.priority ?? 2;
        const score = priority * PRIORITY_MULTIPLIER + Date.now();
        pipeline.zadd(this.queueKey(queue), score, item);
        pipeline.zrem(this.delayedKey(queue), item);
      }
      await pipeline.exec();
    }
  }
}
