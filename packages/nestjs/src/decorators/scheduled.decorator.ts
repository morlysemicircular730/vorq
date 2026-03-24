import "reflect-metadata";

export const VORQ_SCHEDULE_CRON = "VORQ_SCHEDULE_CRON";

export const Scheduled =
  (cron: string): MethodDecorator =>
  (_target, _propertyKey, descriptor) => {
    Reflect.defineMetadata(VORQ_SCHEDULE_CRON, cron, descriptor.value as object);
    return descriptor;
  };
