export enum Priority {
  CRITICAL = 0,
  HIGH = 1,
  MEDIUM = 2,
  LOW = 3,
}

export enum TaskStatus {
  WAITING = "WAITING",
  PENDING = "PENDING",
  QUEUED = "QUEUED",
  ACTIVE = "ACTIVE",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  RETRYING = "RETRYING",
  ABANDONED = "ABANDONED",
}

export interface BackoffStrategy {
  calculate(attempt: number): number;
}

export interface TaskOptions {
  priority?: Priority;
  delay?: number;
  maxRetries?: number;
  backoff?: BackoffStrategy;
  timeout?: number;
  dependsOn?: string[];
}

export interface TaskDefinition<TPayload = unknown> {
  name: string;
  payload: TPayload;
  options?: TaskOptions;
}

export interface TaskRecord {
  id: string;
  queue: string;
  name: string;
  payload: unknown;
  status: TaskStatus;
  priority: number;
  result?: unknown;
  error?: string;
  attempt: number;
  maxRetries: number;
  progress: number;
  scheduleId?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface TaskAttemptRecord {
  attempt: number;
  error: string;
  startedAt: Date;
  duration: number;
}

export interface DeadLetterRecord {
  taskId: string;
  queue: string;
  payload: unknown;
  error: string;
  attempts: number;
  failedAt: Date;
  history: TaskAttemptRecord[];
}
