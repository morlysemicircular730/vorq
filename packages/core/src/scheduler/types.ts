import type { TaskDefinition } from "../task/types.js";

export interface ScheduleOptions {
  overlap?: boolean;
}

export interface ScheduleEntry {
  id: string;
  queue: string;
  cron: string;
  task: TaskDefinition;
  options: Required<ScheduleOptions>;
  lastRun: Date | null;
  nextRun: Date;
}
