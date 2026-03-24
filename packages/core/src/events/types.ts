export interface VorqEventMap {
  "task.enqueued": { taskId: string; queue: string };
  "task.active": { taskId: string; queue: string; attempt: number };
  "task.completed": { taskId: string; queue: string; result: unknown; duration: number };
  "task.failed": { taskId: string; queue: string; error: Error; attempt: number };
  "task.retrying": { taskId: string; queue: string; attempt: number; nextDelay: number };
  "task.deadLettered": { taskId: string; queue: string; error: Error; attempts: number };
  "task.abandoned": { taskId: string; queue: string; reason: string };
  "task.progress": { taskId: string; queue: string; percent: number };
}

export type VorqEvent = keyof VorqEventMap;
export type VorqEventListener<E extends VorqEvent> = (
  data: VorqEventMap[E],
) => void | Promise<void>;
