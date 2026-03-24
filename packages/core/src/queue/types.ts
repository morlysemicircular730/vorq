import type { TaskDefinition } from "../task/types.js";

export interface QueueHandle {
  name: string;
  enqueue<T>(task: TaskDefinition<T>): Promise<string>;
  pause(): Promise<void>;
  resume(): Promise<void>;
}
