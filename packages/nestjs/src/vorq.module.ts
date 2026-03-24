import {
  type DynamicModule,
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { DiscoveryModule, DiscoveryService, MetadataScanner } from "@nestjs/core";
import type { InstanceWrapper } from "@nestjs/core/injector/instance-wrapper.js";
import type { VorqConfig } from "@vorq/core";
import { Vorq } from "@vorq/core";
import { VORQ_SCHEDULE_CRON } from "./decorators/scheduled.decorator.js";
import { VORQ_TASK_NAME } from "./decorators/task.decorator.js";
import { VORQ_WORKER_QUEUE } from "./decorators/worker.decorator.js";
import { VORQ_INSTANCE, VorqService } from "./vorq.service.js";

// biome-ignore lint/suspicious/noExplicitAny: NestJS async options require any for DI tokens
type NestAny = any;

export interface VorqAsyncOptions {
  imports?: NestAny[];
  useFactory: (...args: NestAny[]) => Promise<VorqConfig> | VorqConfig;
  inject?: NestAny[];
}

@Module({})
export class VorqModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(VORQ_INSTANCE) private readonly vorq: Vorq,
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
  ) {}

  static forRoot(config: VorqConfig): DynamicModule {
    return {
      module: VorqModule,
      imports: [DiscoveryModule],
      providers: [{ provide: VORQ_INSTANCE, useValue: new Vorq(config) }, VorqService],
      exports: [VorqService, VORQ_INSTANCE],
      global: true,
    };
  }

  static forRootAsync(options: VorqAsyncOptions): DynamicModule {
    return {
      module: VorqModule,
      imports: [DiscoveryModule, ...(options.imports ?? [])],
      providers: [
        {
          provide: VORQ_INSTANCE,
          useFactory: async (...args: NestAny[]) => {
            const config = await options.useFactory(...args);
            return new Vorq(config);
          },
          inject: options.inject ?? [],
        },
        VorqService,
      ],
      exports: [VorqService, VORQ_INSTANCE],
      global: true,
    };
  }

  async onModuleInit() {
    for (const wrapper of this.discovery.getProviders()) {
      this.registerProvider(wrapper);
    }
    await this.vorq.start();
  }

  async onModuleDestroy() {
    await this.vorq.shutdown();
  }

  private registerProvider(wrapper: InstanceWrapper) {
    const instance = wrapper.instance;
    if (!instance || typeof instance !== "object") return;

    const prototype = Object.getPrototypeOf(instance);
    if (!prototype) return;

    const queue = Reflect.getMetadata(VORQ_WORKER_QUEUE, prototype.constructor) as
      | string
      | undefined;
    if (!queue) return;

    for (const methodName of this.scanner.getAllMethodNames(prototype)) {
      this.registerMethod(queue, instance, prototype, methodName);
    }
  }

  private registerMethod(
    queue: string,
    instance: object,
    prototype: Record<string, unknown>,
    methodName: string,
  ) {
    const method = prototype[methodName];
    if (typeof method !== "function") return;

    const taskName = Reflect.getMetadata(VORQ_TASK_NAME, method) as string | undefined;
    if (taskName) {
      this.vorq.registerWorker(queue, (ctx) => method.call(instance, ctx));
    }

    const cron = Reflect.getMetadata(VORQ_SCHEDULE_CRON, method) as string | undefined;
    if (cron) {
      this.vorq.schedule(queue, cron, { name: taskName ?? methodName, payload: {} });
    }
  }
}
