import "reflect-metadata";
import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { InMemoryTransport, type TaskContext } from "@vorq/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Task } from "./decorators/task.decorator.js";
import { Worker } from "./decorators/worker.decorator.js";
import { VorqModule } from "./vorq.module.js";
import { VorqService } from "./vorq.service.js";

describe("VorqModule", () => {
  let transport: InMemoryTransport;

  beforeEach(() => {
    transport = new InMemoryTransport();
  });

  it("forRoot() creates module with VorqService injectable", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [VorqModule.forRoot({ transport })],
    }).compile();

    await moduleRef.init();

    const service = moduleRef.get(VorqService);
    expect(service).toBeInstanceOf(VorqService);

    await moduleRef.close();
  });

  it("VorqService.enqueue() works", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [VorqModule.forRoot({ transport })],
    }).compile();

    await moduleRef.init();

    const service = moduleRef.get(VorqService);
    await service.createQueue("test");

    const taskId = await service.enqueue("test", { name: "job", payload: { x: 1 } });
    expect(taskId).toMatch(/^[0-9a-f]{8}-/);

    const published = transport.getPublished("test");
    expect(published).toHaveLength(1);
    expect(published[0]?.task.taskName).toBe("job");

    await moduleRef.close();
  });

  it("@Worker/@Task decorators register handlers", async () => {
    const handler = vi.fn(async (_ctx: TaskContext) => "done");

    @Injectable()
    @Worker("tasks")
    class TestWorker {
      @Task("process")
      async handle(ctx: TaskContext) {
        return handler(ctx);
      }
    }

    const moduleRef = await Test.createTestingModule({
      imports: [VorqModule.forRoot({ transport })],
      providers: [TestWorker],
    }).compile();

    await moduleRef.init();

    const service = moduleRef.get(VorqService);
    await service.createQueue("tasks");
    await service.enqueue("tasks", { name: "process", payload: {} });

    await transport.drain("tasks");
    await new Promise((r) => setTimeout(r, 50));

    expect(handler).toHaveBeenCalledOnce();

    await moduleRef.close();
  });

  it("module shuts down cleanly", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [VorqModule.forRoot({ transport })],
    }).compile();

    await moduleRef.init();
    expect(transport.isConnected()).toBe(true);

    await moduleRef.close();
    expect(transport.isConnected()).toBe(false);
  });

  it("forRootAsync() creates module with factory", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        VorqModule.forRootAsync({
          useFactory: () => ({ transport }),
        }),
      ],
    }).compile();

    await moduleRef.init();

    const service = moduleRef.get(VorqService);
    expect(service).toBeInstanceOf(VorqService);

    await moduleRef.close();
  });
});
