export interface TaskContext<T = unknown> {
  id: string;
  name: string;
  payload: T;
  attempt: number;
  progress(percent: number): Promise<void>;
  log(message: string): void;
  signal: AbortSignal;
}

export type TaskHandler<T = unknown, R = unknown> = (context: TaskContext<T>) => Promise<R>;

export interface WorkerOptions {
  concurrency: number;
  pollInterval: number;
  lockDuration: number;
  batchSize: number;
}

export interface WorkerHandle {
  pause(): void;
  resume(): void;
  isRunning(): boolean;
}

export const DEFAULT_WORKER_OPTIONS: Required<WorkerOptions> = {
  concurrency: 1,
  pollInterval: 1000,
  lockDuration: 30000,
  batchSize: 1,
};
