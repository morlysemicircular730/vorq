import "reflect-metadata";

export const VORQ_TASK_NAME = "VORQ_TASK_NAME";

export const Task =
  (name: string): MethodDecorator =>
  (_target, _propertyKey, descriptor) => {
    Reflect.defineMetadata(VORQ_TASK_NAME, name, descriptor.value as object);
    return descriptor;
  };
