import type { TaskRecord, TaskStatus } from "../task/types.js";

export interface TaskFilter {
  queue?: string;
  status?: TaskStatus | TaskStatus[];
  name?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
  orderBy?: "createdAt" | "completedAt";
  order?: "asc" | "desc";
}

export interface QueueMetrics {
  pending: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  avgDuration: number;
  throughput: number;
}

export interface StorageAdapter {
  saveTask(task: TaskRecord): Promise<void>;
  updateTask(id: string, update: Partial<TaskRecord>): Promise<void>;
  getTask(id: string): Promise<TaskRecord | null>;
  queryTasks(filter: TaskFilter): Promise<TaskRecord[]>;
  getMetrics(queue?: string): Promise<QueueMetrics>;
}
