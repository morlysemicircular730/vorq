import type { Priority } from "../task/types.js";

export interface TaskMessage {
  taskId: string;
  taskName: string;
  queue: string;
  payload: unknown;
  attempt: number;
  priority: Priority;
  delay: number;
  maxRetries: number;
  createdAt: number;
}

export interface MessageEnvelope {
  messageId: string;
  task: TaskMessage;
  receivedAt: number;
}

export type MessageHandler = (envelope: MessageEnvelope) => Promise<void>;

export interface PublishOptions {
  priority?: Priority;
  delay?: number;
  messageId?: string;
}

export interface RateLimiterOptions {
  maxPerInterval: number;
  interval: number;
}

export interface QueueOptions {
  maxPriority?: number;
  deadLetterQueue?: string;
  messageTtl?: number;
  maxLength?: number;
  rateLimiter?: RateLimiterOptions;
}

export interface TransportAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  publish(queue: string, message: TaskMessage, options: PublishOptions): Promise<void>;
  subscribe(queue: string, handler: MessageHandler): Promise<void>;
  acknowledge(envelope: MessageEnvelope): Promise<void>;
  reject(envelope: MessageEnvelope, requeue: boolean): Promise<void>;
  createQueue(name: string, options: QueueOptions): Promise<void>;
  deleteQueue(name: string): Promise<void>;
}
