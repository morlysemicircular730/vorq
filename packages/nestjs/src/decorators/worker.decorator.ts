import { SetMetadata } from "@nestjs/common";

export const VORQ_WORKER_QUEUE = "VORQ_WORKER_QUEUE";
export const Worker = (queue: string) => SetMetadata(VORQ_WORKER_QUEUE, queue);
