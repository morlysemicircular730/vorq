# Vorq Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Vorq — a distributed task queue library for TypeScript, published as npm packages.

**Architecture:** Library-first monorepo with 4 packages: `@vorq/core` (queue engine, workers, retry, DAG, scheduler), `@vorq/redis` (Redis transport), `@vorq/rabbitmq` (RabbitMQ transport), `@vorq/nestjs` (NestJS integration). Pluggable transport/storage via adapter interfaces. All business logic lives in core.

**Tech Stack:** TypeScript, Turborepo, Biome, Vitest, tsup, Prisma, cron-parser

**Spec:** `docs/superpowers/specs/2026-03-23-vorq-design.md`

**Note:** No git operations until user explicitly asks. No Co-Authored-By in commits.

---

## Phase 1: Monorepo Scaffolding

### Task 1: Root Workspace Setup

**Files:**
- Create: `package.json`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `biome.json`
- Create: `.npmrc`
- Create: `.gitignore`
- Create: `LICENSE`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "vorq",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "clean": "turbo run clean"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "turbo": "^2.3.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "tsup": "^8.3.0"
  },
  "packageManager": "npm@10.9.0",
  "engines": {
    "node": ">=20.0.0"
  }
}
```

- [ ] **Step 2: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {},
    "clean": {
      "cache": false
    }
  }
}
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": false,
    "outDir": "dist",
    "rootDir": "src"
  },
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": {
        "noExcessiveCognitiveComplexity": {
          "level": "warn",
          "options": { "maxAllowedComplexity": 15 }
        }
      },
      "style": {
        "noNonNullAssertion": "warn",
        "useConst": "error"
      },
      "suspicious": {
        "noExplicitAny": "warn"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "files": {
    "ignore": ["node_modules", "dist", "*.prisma"]
  }
}
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
.turbo/
*.tsbuildinfo
.env
.env.*
coverage/
```

- [ ] **Step 6: Create .npmrc**

```
save-exact=true
```

- [ ] **Step 7: Create LICENSE (MIT)**

Standard MIT license with `Copyright (c) 2026 Vorq Contributors`.

- [ ] **Step 8: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 9: Verify biome works**

Run: `npx biome check .`
Expected: No errors (no source files yet).

---

### Task 2: Package Scaffolding — @vorq/core

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/tsup.config.ts`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Create packages/core/package.json**

```json
{
  "name": "@vorq/core",
  "version": "0.1.0",
  "description": "Distributed task queue for TypeScript",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist"
  },
  "keywords": ["task-queue", "distributed", "workers", "typescript", "queue"],
  "license": "MIT",
  "peerDependencies": {
    "@prisma/client": ">=5.0.0"
  },
  "peerDependenciesMeta": {
    "@prisma/client": {
      "optional": true
    }
  }
}
```

- [ ] **Step 2: Create packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create packages/core/tsup.config.ts**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
});
```

- [ ] **Step 4: Create packages/core/vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create packages/core/src/index.ts**

```ts
export {};
```

- [ ] **Step 6: Verify build works**

Run: `npx turbo run build --filter=@vorq/core`
Expected: `packages/core/dist/` created with index.js, index.cjs, index.d.ts.

- [ ] **Step 7: Verify test works**

Run: `npx turbo run test --filter=@vorq/core`
Expected: "No test files found" or similar (no tests yet).

---

### Task 3: Package Scaffolding — @vorq/redis, @vorq/rabbitmq, @vorq/nestjs

**Files:**
- Create: `packages/redis/package.json`
- Create: `packages/redis/tsconfig.json`
- Create: `packages/redis/tsup.config.ts`
- Create: `packages/redis/vitest.config.ts`
- Create: `packages/redis/src/index.ts`
- Create: `packages/rabbitmq/package.json`
- Create: `packages/rabbitmq/tsconfig.json`
- Create: `packages/rabbitmq/tsup.config.ts`
- Create: `packages/rabbitmq/vitest.config.ts`
- Create: `packages/rabbitmq/src/index.ts`
- Create: `packages/nestjs/package.json`
- Create: `packages/nestjs/tsconfig.json`
- Create: `packages/nestjs/tsup.config.ts`
- Create: `packages/nestjs/vitest.config.ts`
- Create: `packages/nestjs/src/index.ts`

- [ ] **Step 1: Create packages/redis/package.json**

Same structure as core with:
- `"name": "@vorq/redis"`
- `"description": "Redis transport adapter for Vorq"`
- `"dependencies": { "ioredis": "^5.4.0" }`
- `"peerDependencies": { "@vorq/core": "^0.1.0" }`

- [ ] **Step 2: Create packages/redis/ config files**

Same tsconfig.json, tsup.config.ts, vitest.config.ts pattern as core.

- [ ] **Step 3: Create packages/rabbitmq/package.json**

Same structure with:
- `"name": "@vorq/rabbitmq"`
- `"description": "RabbitMQ transport adapter for Vorq"`
- `"dependencies": { "amqplib": "^0.10.0" }`
- `"peerDependencies": { "@vorq/core": "^0.1.0" }`

- [ ] **Step 4: Create packages/rabbitmq/ config files**

Same pattern.

- [ ] **Step 5: Create packages/nestjs/package.json**

Same structure with:
- `"name": "@vorq/nestjs"`
- `"description": "NestJS integration for Vorq"`
- `"peerDependencies": { "@vorq/core": "^0.1.0", "@nestjs/common": ">=10.0.0", "@nestjs/core": ">=10.0.0" }`

- [ ] **Step 6: Create packages/nestjs/ config files**

Same pattern.

- [ ] **Step 7: Create all src/index.ts placeholders**

Each with `export {};`

- [ ] **Step 8: Verify full monorepo build**

Run: `npx turbo run build`
Expected: All 4 packages build successfully.

---

## Phase 2: Core Types & Infrastructure

### Task 4: Error Hierarchy

**Files:**
- Create: `packages/core/src/errors/vorq-error.ts`
- Create: `packages/core/src/errors/transport-error.ts`
- Create: `packages/core/src/errors/task-timeout-error.ts`
- Create: `packages/core/src/errors/cyclic-dependency-error.ts`
- Create: `packages/core/src/errors/queue-not-found-error.ts`
- Create: `packages/core/src/errors/task-not-found-error.ts`
- Create: `packages/core/src/errors/shutdown-error.ts`
- Create: `packages/core/src/errors/index.ts`
- Create: `packages/core/src/errors/vorq-error.test.ts`

- [ ] **Step 1: Write tests for error hierarchy**

Test file: `packages/core/src/errors/vorq-error.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  CyclicDependencyError,
  QueueNotFoundError,
  ShutdownError,
  TaskNotFoundError,
  TaskTimeoutError,
  TransportError,
  VorqError,
} from "./index.js";

describe("VorqError hierarchy", () => {
  it("all errors extend VorqError", () => {
    const errors = [
      new TransportError("connection failed"),
      new TaskTimeoutError("task timed out", "task-1"),
      new CyclicDependencyError("cycle detected", ["a", "b", "a"]),
      new QueueNotFoundError("queue-1"),
      new TaskNotFoundError("task-1"),
      new ShutdownError("shutting down"),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(VorqError);
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBeDefined();
      expect(error.message).toBeDefined();
    }
  });

  it("TransportError has code TRANSPORT_ERROR", () => {
    const error = new TransportError("connection lost");
    expect(error.code).toBe("TRANSPORT_ERROR");
    expect(error.message).toBe("connection lost");
  });

  it("TaskTimeoutError includes taskId", () => {
    const error = new TaskTimeoutError("timeout", "task-123");
    expect(error.code).toBe("TASK_TIMEOUT");
    expect(error.taskId).toBe("task-123");
  });

  it("CyclicDependencyError includes cycle path", () => {
    const error = new CyclicDependencyError("cycle", ["a", "b", "a"]);
    expect(error.code).toBe("CYCLIC_DEPENDENCY");
    expect(error.path).toEqual(["a", "b", "a"]);
  });

  it("QueueNotFoundError includes queue name", () => {
    const error = new QueueNotFoundError("emails");
    expect(error.code).toBe("QUEUE_NOT_FOUND");
    expect(error.message).toContain("emails");
  });

  it("TaskNotFoundError includes task id", () => {
    const error = new TaskNotFoundError("task-1");
    expect(error.code).toBe("TASK_NOT_FOUND");
    expect(error.message).toContain("task-1");
  });

  it("ShutdownError has code SHUTDOWN", () => {
    const error = new ShutdownError("shutting down");
    expect(error.code).toBe("SHUTDOWN");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run --config packages/core/vitest.config.ts src/errors/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement error classes**

`vorq-error.ts`:
```ts
export abstract class VorqError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
```

`transport-error.ts`:
```ts
import { VorqError } from "./vorq-error.js";

export class TransportError extends VorqError {
  readonly code = "TRANSPORT_ERROR";
}
```

`task-timeout-error.ts`:
```ts
import { VorqError } from "./vorq-error.js";

export class TaskTimeoutError extends VorqError {
  readonly code = "TASK_TIMEOUT";

  constructor(
    message: string,
    readonly taskId: string,
  ) {
    super(message);
  }
}
```

`cyclic-dependency-error.ts`:
```ts
import { VorqError } from "./vorq-error.js";

export class CyclicDependencyError extends VorqError {
  readonly code = "CYCLIC_DEPENDENCY";

  constructor(
    message: string,
    readonly path: string[],
  ) {
    super(message);
  }
}
```

`queue-not-found-error.ts`:
```ts
import { VorqError } from "./vorq-error.js";

export class QueueNotFoundError extends VorqError {
  readonly code = "QUEUE_NOT_FOUND";

  constructor(queueName: string) {
    super(`Queue not found: ${queueName}`);
  }
}
```

`task-not-found-error.ts`:
```ts
import { VorqError } from "./vorq-error.js";

export class TaskNotFoundError extends VorqError {
  readonly code = "TASK_NOT_FOUND";

  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
  }
}
```

`shutdown-error.ts`:
```ts
import { VorqError } from "./vorq-error.js";

export class ShutdownError extends VorqError {
  readonly code = "SHUTDOWN";
}
```

`index.ts` — re-export all.

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run --config packages/core/vitest.config.ts src/errors/`
Expected: All tests PASS.

---

### Task 5: Core Types — Task Model

**Files:**
- Create: `packages/core/src/task/types.ts`
- Create: `packages/core/src/task/index.ts`
- Create: `packages/core/src/task/types.test.ts`

- [ ] **Step 1: Write tests for Priority enum and type guards**

```ts
import { describe, expect, it } from "vitest";
import { Priority, TaskStatus } from "./types.js";

describe("Priority", () => {
  it("CRITICAL < HIGH < MEDIUM < LOW", () => {
    expect(Priority.CRITICAL).toBeLessThan(Priority.HIGH);
    expect(Priority.HIGH).toBeLessThan(Priority.MEDIUM);
    expect(Priority.MEDIUM).toBeLessThan(Priority.LOW);
  });
});

describe("TaskStatus", () => {
  it("contains all expected statuses", () => {
    const statuses = [
      TaskStatus.WAITING,
      TaskStatus.PENDING,
      TaskStatus.QUEUED,
      TaskStatus.ACTIVE,
      TaskStatus.COMPLETED,
      TaskStatus.FAILED,
      TaskStatus.RETRYING,
      TaskStatus.ABANDONED,
    ];
    expect(statuses).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run --config packages/core/vitest.config.ts src/task/`
Expected: FAIL.

- [ ] **Step 3: Implement types**

`packages/core/src/task/types.ts`:

```ts
export enum Priority {
  CRITICAL = 0,
  HIGH = 1,
  MEDIUM = 2,
  LOW = 3,
}

export enum TaskStatus {
  WAITING = "WAITING",
  PENDING = "PENDING",
  QUEUED = "QUEUED",
  ACTIVE = "ACTIVE",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  RETRYING = "RETRYING",
  ABANDONED = "ABANDONED",
}

export interface BackoffStrategy {
  calculate(attempt: number): number;
}

export interface TaskOptions {
  priority?: Priority;
  delay?: number;
  maxRetries?: number;
  backoff?: BackoffStrategy;
  timeout?: number;
  dependsOn?: string[];
}

export interface TaskDefinition<TPayload = unknown> {
  name: string;
  payload: TPayload;
  options?: TaskOptions;
}

export interface TaskRecord {
  id: string;
  queue: string;
  name: string;
  payload: unknown;
  status: TaskStatus;
  priority: number;
  result?: unknown;
  error?: string;
  attempt: number;
  maxRetries: number;
  progress: number;
  scheduleId?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface TaskAttemptRecord {
  attempt: number;
  error: string;
  startedAt: Date;
  duration: number;
}

export interface DeadLetterRecord {
  taskId: string;
  queue: string;
  payload: unknown;
  error: string;
  attempts: number;
  failedAt: Date;
  history: TaskAttemptRecord[];
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run --config packages/core/vitest.config.ts src/task/`
Expected: PASS.

---

### Task 6: Transport & Storage Interfaces

**Files:**
- Create: `packages/core/src/transport/types.ts`
- Create: `packages/core/src/transport/index.ts`
- Create: `packages/core/src/persistence/types.ts`
- Create: `packages/core/src/persistence/index.ts`

- [ ] **Step 1: Create transport types**

`packages/core/src/transport/types.ts`:

```ts
import type { Priority } from "../task/types.js";

export interface TaskMessage {
  taskId: string;
  taskName: string;
  queue: string;
  payload: unknown;
  attempt: number;
  priority: Priority;
  delay: number;
  maxRetries: number;
  createdAt: number;
}

export interface MessageEnvelope {
  messageId: string;
  task: TaskMessage;
  receivedAt: number;
}

export type MessageHandler = (envelope: MessageEnvelope) => Promise<void>;

export interface PublishOptions {
  priority?: Priority;
  delay?: number;
  messageId?: string;
}

export interface RateLimiterOptions {
  maxPerInterval: number;
  interval: number;
}

export interface QueueOptions {
  maxPriority?: number;
  deadLetterQueue?: string;
  messageTtl?: number;
  maxLength?: number;
  rateLimiter?: RateLimiterOptions;
}

export interface TransportAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  publish(queue: string, message: TaskMessage, options: PublishOptions): Promise<void>;
  subscribe(queue: string, handler: MessageHandler): Promise<void>;
  acknowledge(envelope: MessageEnvelope): Promise<void>;
  reject(envelope: MessageEnvelope, requeue: boolean): Promise<void>;
  createQueue(name: string, options: QueueOptions): Promise<void>;
  deleteQueue(name: string): Promise<void>;
}
```

- [ ] **Step 2: Create persistence types**

`packages/core/src/persistence/types.ts`:

```ts
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
```

- [ ] **Step 3: Create index.ts files**

Re-export all types from each module.

- [ ] **Step 4: Verify build**

Run: `npx turbo run build --filter=@vorq/core`
Expected: Build succeeds.

---

### Task 7: Logging

**Files:**
- Create: `packages/core/src/logging/types.ts`
- Create: `packages/core/src/logging/console-logger.ts`
- Create: `packages/core/src/logging/console-logger.test.ts`
- Create: `packages/core/src/logging/index.ts`

- [ ] **Step 1: Write test for ConsoleLogger**

```ts
import { describe, expect, it, vi } from "vitest";
import { ConsoleLogger } from "./console-logger.js";

describe("ConsoleLogger", () => {
  it("logs info messages", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = new ConsoleLogger();
    logger.info("test message", { key: "value" });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("logs warn messages", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = new ConsoleLogger();
    logger.warn("warning");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("logs error messages", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new ConsoleLogger();
    logger.error("error");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("logs debug messages", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const logger = new ConsoleLogger();
    logger.debug("debug");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement VorqLogger interface and ConsoleLogger**

`types.ts`:
```ts
export interface VorqLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}
```

`console-logger.ts`:
```ts
import type { VorqLogger } from "./types.js";

export class ConsoleLogger implements VorqLogger {
  info(message: string, meta?: Record<string, unknown>): void {
    console.info(`[vorq] ${message}`, meta ?? "");
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(`[vorq] ${message}`, meta ?? "");
  }

  error(message: string, meta?: Record<string, unknown>): void {
    console.error(`[vorq] ${message}`, meta ?? "");
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    console.debug(`[vorq] ${message}`, meta ?? "");
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

---

### Task 8: EventBus

**Files:**
- Create: `packages/core/src/events/types.ts`
- Create: `packages/core/src/events/event-bus.ts`
- Create: `packages/core/src/events/event-bus.test.ts`
- Create: `packages/core/src/events/index.ts`

- [ ] **Step 1: Write tests for EventBus**

```ts
import { describe, expect, it, vi } from "vitest";
import { ConsoleLogger } from "../logging/console-logger.js";
import { EventBus } from "./event-bus.js";

describe("EventBus", () => {
  it("emits events to listeners", async () => {
    const bus = new EventBus(new ConsoleLogger());
    const listener = vi.fn();

    bus.on("task.completed", listener);
    await bus.emit("task.completed", { taskId: "1", queue: "q", result: null, duration: 100 });

    expect(listener).toHaveBeenCalledWith({
      taskId: "1",
      queue: "q",
      result: null,
      duration: 100,
    });
  });

  it("supports multiple listeners for same event", async () => {
    const bus = new EventBus(new ConsoleLogger());
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    bus.on("task.failed", listener1);
    bus.on("task.failed", listener2);
    await bus.emit("task.failed", { taskId: "1", queue: "q", error: new Error("fail"), attempt: 1 });

    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();
  });

  it("does not throw when listener throws — logs error instead", async () => {
    const logger = new ConsoleLogger();
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const bus = new EventBus(logger);

    bus.on("task.completed", () => {
      throw new Error("listener crash");
    });

    await expect(
      bus.emit("task.completed", { taskId: "1", queue: "q", result: null, duration: 0 })
    ).resolves.not.toThrow();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("off removes listener", async () => {
    const bus = new EventBus(new ConsoleLogger());
    const listener = vi.fn();

    bus.on("task.completed", listener);
    bus.off("task.completed", listener);
    await bus.emit("task.completed", { taskId: "1", queue: "q", result: null, duration: 0 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("does nothing when emitting event with no listeners", async () => {
    const bus = new EventBus(new ConsoleLogger());
    await expect(
      bus.emit("task.completed", { taskId: "1", queue: "q", result: null, duration: 0 })
    ).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement EventBus**

`types.ts`:
```ts
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
export type VorqEventListener<E extends VorqEvent> = (data: VorqEventMap[E]) => void | Promise<void>;
```

`event-bus.ts`:
```ts
import type { VorqLogger } from "../logging/types.js";
import type { VorqEvent, VorqEventListener, VorqEventMap } from "./types.js";

export class EventBus {
  private readonly listeners = new Map<string, Set<VorqEventListener<VorqEvent>>>();

  constructor(private readonly logger: VorqLogger) {}

  on<E extends VorqEvent>(event: E, listener: VorqEventListener<E>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as VorqEventListener<VorqEvent>);
  }

  off<E extends VorqEvent>(event: E, listener: VorqEventListener<E>): void {
    this.listeners.get(event)?.delete(listener as VorqEventListener<VorqEvent>);
  }

  async emit<E extends VorqEvent>(event: E, data: VorqEventMap[E]): Promise<void> {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return;

    for (const listener of eventListeners) {
      try {
        await listener(data);
      } catch (error) {
        this.logger.error(`EventBus listener error on ${event}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

---

## Phase 3: Core Engine

### Task 9: InMemoryTransport

**Files:**
- Create: `packages/core/src/transport/in-memory-transport.ts`
- Create: `packages/core/src/transport/in-memory-transport.test.ts`

- [ ] **Step 1: Write tests**

Test cases:
- `connect()` / `disconnect()` / `isConnected()` lifecycle
- `createQueue()` / `deleteQueue()`
- `publish()` stores message in queue
- `subscribe()` delivers messages to handler
- `acknowledge()` removes message from processing
- `reject(envelope, true)` requeues message
- `reject(envelope, false)` discards message
- `publish()` throws `TransportError` when disconnected
- `getPublished()` helper returns all published messages
- `drain()` helper processes all pending messages

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement InMemoryTransport**

Full `TransportAdapter` implementation using `Map<string, MessageEnvelope[]>` for queues. Messages are stored in-memory. `subscribe()` handler is called immediately on `drain()` or via internal polling.

Key design: `publish()` adds to queue. `drain(queueName)` calls all subscribed handlers for pending messages. No automatic delivery — tests explicitly call `drain()` for deterministic behavior.

- [ ] **Step 4: Run tests — verify pass**

---

### Task 10: Backoff Strategies

**Files:**
- Create: `packages/core/src/retry/fixed-backoff.ts`
- Create: `packages/core/src/retry/exponential-backoff.ts`
- Create: `packages/core/src/retry/exponential-jitter-backoff.ts`
- Create: `packages/core/src/retry/backoff.test.ts`
- Create: `packages/core/src/retry/index.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, expect, it } from "vitest";
import { ExponentialBackoff } from "./exponential-backoff.js";
import { ExponentialJitterBackoff } from "./exponential-jitter-backoff.js";
import { FixedBackoff } from "./fixed-backoff.js";

describe("FixedBackoff", () => {
  it("returns constant delay", () => {
    const backoff = new FixedBackoff(5000);
    expect(backoff.calculate(1)).toBe(5000);
    expect(backoff.calculate(2)).toBe(5000);
    expect(backoff.calculate(10)).toBe(5000);
  });
});

describe("ExponentialBackoff", () => {
  it("returns exponentially increasing delay", () => {
    const backoff = new ExponentialBackoff(1000, 60000);
    expect(backoff.calculate(1)).toBe(1000);
    expect(backoff.calculate(2)).toBe(2000);
    expect(backoff.calculate(3)).toBe(4000);
    expect(backoff.calculate(4)).toBe(8000);
  });

  it("caps at maxDelay", () => {
    const backoff = new ExponentialBackoff(1000, 5000);
    expect(backoff.calculate(10)).toBe(5000);
  });
});

describe("ExponentialJitterBackoff", () => {
  it("returns value between 1 and exponential delay", () => {
    const backoff = new ExponentialJitterBackoff(1000, 60000);
    for (let i = 0; i < 100; i++) {
      const delay = backoff.calculate(3);
      expect(delay).toBeGreaterThanOrEqual(1);
      expect(delay).toBeLessThanOrEqual(4000);
    }
  });

  it("caps at maxDelay", () => {
    const backoff = new ExponentialJitterBackoff(1000, 3000);
    for (let i = 0; i < 100; i++) {
      const delay = backoff.calculate(20);
      expect(delay).toBeLessThanOrEqual(3000);
    }
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement backoff strategies**

`fixed-backoff.ts`:
```ts
import type { BackoffStrategy } from "../task/types.js";

export class FixedBackoff implements BackoffStrategy {
  constructor(private readonly delay: number) {}

  calculate(_attempt: number): number {
    return this.delay;
  }
}
```

`exponential-backoff.ts`:
```ts
import type { BackoffStrategy } from "../task/types.js";

export class ExponentialBackoff implements BackoffStrategy {
  constructor(
    private readonly base: number,
    private readonly maxDelay: number,
  ) {}

  calculate(attempt: number): number {
    const delay = this.base * Math.pow(2, attempt - 1);
    return Math.min(delay, this.maxDelay);
  }
}
```

`exponential-jitter-backoff.ts`:
```ts
import type { BackoffStrategy } from "../task/types.js";

export class ExponentialJitterBackoff implements BackoffStrategy {
  constructor(
    private readonly base: number,
    private readonly maxDelay: number,
  ) {}

  calculate(attempt: number): number {
    const exponentialDelay = this.base * Math.pow(2, attempt - 1);
    const capped = Math.min(exponentialDelay, this.maxDelay);
    return Math.max(1, Math.floor(Math.random() * capped));
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

---

### Task 11: RetryPolicy & Retry Handler

**Files:**
- Create: `packages/core/src/retry/retry-policy.ts`
- Create: `packages/core/src/retry/retry-policy.test.ts`

- [ ] **Step 1: Write tests**

Test cases:
- `shouldRetry()` returns true when `attempt < maxRetries`
- `shouldRetry()` returns false when `attempt >= maxRetries`
- `shouldRetry()` returns false when error not in `retryableErrors` (if configured)
- `shouldRetry()` returns true when error IS in `retryableErrors`
- `getDelay()` delegates to backoff strategy
- Default backoff is `ExponentialJitterBackoff(1000, 30000)`

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement RetryPolicy**

```ts
import type { BackoffStrategy } from "../task/types.js";
import { ExponentialJitterBackoff } from "./exponential-jitter-backoff.js";

export interface RetryPolicyConfig {
  maxRetries: number;
  backoff?: BackoffStrategy;
  retryableErrors?: string[];
}

export class RetryPolicy {
  readonly maxRetries: number;
  readonly backoff: BackoffStrategy;
  private readonly retryableErrors?: Set<string>;

  constructor(config: RetryPolicyConfig) {
    this.maxRetries = config.maxRetries;
    this.backoff = config.backoff ?? new ExponentialJitterBackoff(1000, 30000);
    this.retryableErrors = config.retryableErrors
      ? new Set(config.retryableErrors)
      : undefined;
  }

  shouldRetry(attempt: number, error: Error): boolean {
    if (attempt >= this.maxRetries) return false;
    if (this.retryableErrors && !this.retryableErrors.has(error.name)) return false;
    return true;
  }

  getDelay(attempt: number): number {
    return this.backoff.calculate(attempt);
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

---

### Task 12: Semaphore

**Files:**
- Create: `packages/core/src/worker/semaphore.ts`
- Create: `packages/core/src/worker/semaphore.test.ts`

- [ ] **Step 1: Write tests**

Test cases:
- `acquire()` resolves immediately when permits available
- `acquire()` blocks when no permits available
- `release()` unblocks a waiting `acquire()`
- Multiple waiters are served in order (FIFO)
- Concurrent acquire/release stress test

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement Semaphore**

```ts
export class Semaphore {
  private permits: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }

  get available(): number {
    return this.permits;
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

---

### Task 13: DAGResolver

**Files:**
- Create: `packages/core/src/dag/dag-resolver.ts`
- Create: `packages/core/src/dag/dag-resolver.test.ts`
- Create: `packages/core/src/dag/index.ts`

- [ ] **Step 1: Write tests**

Test cases:
- `addTask()` with no dependencies — task immediately ready
- `addTask()` with dependencies — task not ready until all deps completed
- `resolve(completedId)` returns newly ready tasks
- `resolve()` returns empty array when no dependents are freed
- Cycle detection — `addTask()` throws `CyclicDependencyError`
- Diamond dependency: A → B, A → C, B → D, C → D — D ready only after both B and C complete
- `abandon(failedId)` returns all downstream task IDs
- Max depth 100 — throws on deeper graphs
- `isReady()` correctly reports task readiness

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement DAGResolver**

Key internal structure:
- `dependencies: Map<string, Set<string>>` — taskId → set of task IDs it depends on
- `dependents: Map<string, Set<string>>` — taskId → set of task IDs that depend on it
- `completed: Set<string>` — completed task IDs

`addTask()`: register dependencies, validate acyclicity via DFS cycle detection. Check depth ≤ 100.

`resolve(completedId)`: mark as completed, check each dependent — if all its dependencies are in completed set, it's ready. Return ready IDs.

`abandon(failedId)`: BFS/DFS to collect all downstream tasks.

- [ ] **Step 4: Run tests — verify pass**

---

### Task 14: CronScheduler

**Files:**
- Create: `packages/core/src/scheduler/cron-scheduler.ts`
- Create: `packages/core/src/scheduler/cron-scheduler.test.ts`
- Create: `packages/core/src/scheduler/index.ts`

- [ ] **Step 1: Install cron-parser**

Run: `cd packages/core && npm install cron-parser`

- [ ] **Step 2: Write tests**

Test cases:
- `register()` returns schedule ID
- `register()` throws on invalid cron expression
- `getSchedules()` lists all registered schedules
- `unregister()` removes schedule
- `tick()` (exposed for testing) enqueues task when `nextRun <= now`
- `tick()` does not enqueue when `nextRun > now`
- `tick()` updates `lastRun` and `nextRun` after enqueue
- Overlap protection: `tick()` skips when previous task still active (overlap: false)

Note: Tests use a mock enqueue callback and manual `tick()` invocations — no real timers.

- [ ] **Step 3: Run test — verify it fails**

- [ ] **Step 4: Implement CronScheduler**

Define `ScheduleOptions` in `packages/core/src/scheduler/types.ts`:
```ts
export interface ScheduleOptions {
  overlap?: boolean;
}

export interface ScheduleEntry {
  id: string;
  queue: string;
  cron: string;
  task: TaskDefinition;
  options: ScheduleOptions;
  lastRun: Date | null;
  nextRun: Date;
}
```

Constructor takes: `enqueue` callback, `logger`, optional `isTaskActive` callback for overlap protection.

`register()`: parse cron (throws VorqError on invalid expression), calculate nextRun, store in internal Map.
`tick()`: iterate schedules, check nextRun, respect overlap setting, call enqueue callback.
`start()`: `setInterval(tick, 30_000)`.
`stop()`: `clearInterval()`.

**Note on distributed deduplication:** Single-instance scheduling works out of the box. For multi-instance deduplication, the CronScheduler accepts an optional `distributedLock` callback that the transport adapters can provide (Redis: `SET NX EX`, PostgreSQL: `SELECT...FOR UPDATE SKIP LOCKED`). This is wired in the Vorq facade based on available transport/storage.

- [ ] **Step 5: Run tests — verify pass**

---

### Task 15: Worker Types & WorkerPool

**Files:**
- Create: `packages/core/src/worker/types.ts`
- Create: `packages/core/src/worker/worker-pool.ts`
- Create: `packages/core/src/worker/worker-pool.test.ts`
- Create: `packages/core/src/worker/index.ts`

- [ ] **Step 1: Define worker types**

`packages/core/src/worker/types.ts`:
```ts
import type { AbortSignal } from "node:events";

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
```

- [ ] **Step 2: Write tests**

Test cases:
- Worker subscribes to transport queue on start
- Worker calls handler with TaskContext when message received
- Worker respects concurrency (semaphore limits parallel tasks)
- Worker acknowledges on successful handler completion
- Worker rejects on handler failure (for retry)
- `TaskContext.signal` is triggered on shutdown
- `TaskContext.progress()` emits `task.progress` event via EventBus
- `TaskContext.log()` delegates to logger
- `pause()` / `resume()` stops/starts consuming
- `isRunning()` reflects state
- Lock heartbeat: worker extends lock at `lockDuration / 2` intervals for active tasks
- Task timeout: task exceeding `timeout` option is aborted with `TaskTimeoutError`
- Graceful shutdown: unfinished tasks are requeued via `reject(envelope, true)`
- Graceful shutdown: waits up to `timeout` ms for active tasks before aborting

- [ ] **Step 3: Run test — verify it fails**

- [ ] **Step 4: Implement WorkerPool**

Key responsibilities:
1. Subscribe to transport queue
2. On message: acquire semaphore, build `TaskContext` with AbortController, call handler
3. Start lock heartbeat timer at `lockDuration / 2` — re-publishes lock extension to transport
4. Start task timeout timer if `TaskOptions.timeout` is set — aborts with `TaskTimeoutError`
5. On success: clear timers, acknowledge, emit `task.completed`
6. On error: clear timers, emit `task.failed`, consult RetryPolicy
   - If retryable: emit `task.retrying`, publish delayed message back to queue
   - If not: emit `task.deadLettered`, publish to `dlq:{queueName}` queue
7. On shutdown: set `shuttingDown` flag, stop accepting new messages, wait for active tasks up to timeout, trigger AbortSignal on remaining, reject+requeue unfinished, release semaphore

Constructor takes: transport, eventBus, logger, retryPolicy, workerOptions.

- [ ] **Step 5: Run tests — verify pass**

---

### Task 16: QueueManager

**Files:**
- Create: `packages/core/src/queue/types.ts`
- Create: `packages/core/src/queue/queue-manager.ts`
- Create: `packages/core/src/queue/queue-manager.test.ts`
- Create: `packages/core/src/queue/index.ts`

- [ ] **Step 1: Define queue types**

`packages/core/src/queue/types.ts`:
```ts
import type { TaskDefinition } from "../task/types.js";

export interface QueueHandle {
  name: string;
  enqueue<T>(task: TaskDefinition<T>): Promise<string>;
  pause(): Promise<void>;
  resume(): Promise<void>;
}
```

- [ ] **Step 2: Write tests**

Test cases:
- `createQueue()` creates queue in transport and returns `QueueHandle`
- `createQueue()` also creates `dlq:{name}` queue in transport for dead letter
- `createQueue()` with same name throws error
- `QueueHandle.enqueue()` publishes to transport
- `QueueHandle.pause()` / `resume()` delegates to workers
- `getQueue()` throws `QueueNotFoundError` for unknown queue

- [ ] **Step 3: Run test — verify it fails**

- [ ] **Step 4: Implement QueueManager**

Manages the registry of queues. On `createQueue()`: creates both the main queue and `dlq:{name}` queue in transport. Stores QueueHandle instances. Each QueueHandle wraps the queue name and provides convenience methods.

- [ ] **Step 5: Run tests — verify pass**

---

### Task 17: Vorq Facade

**Files:**
- Create: `packages/core/src/vorq.ts`
- Create: `packages/core/src/vorq.test.ts`

- [ ] **Step 1: Write tests**

Test cases using InMemoryTransport (integration-level):
- `new Vorq(config)` creates instance
- `start()` connects transport
- `shutdown()` disconnects transport, gracefully stops workers
- `createQueue()` returns QueueHandle
- `enqueue()` publishes task, returns task ID (UUID via `crypto.randomUUID()`)
- `enqueueBatch()` publishes multiple tasks, returns array of IDs
- `registerWorker()` returns WorkerHandle
- Full flow: enqueue → worker processes → task.completed event
- DAG flow: enqueue A, enqueue B with `dependsOn: [A]` → B stays WAITING → A completes → B becomes PENDING and is published → B completes
- DAG failure: A fails → B is ABANDONED with `task.abandoned` event
- `dependsOn` without storage + non-InMemoryTransport → throws VorqError
- `schedule()` registers cron schedule, returns schedule ID
- `schedule()` with invalid cron → throws VorqError
- `on()` receives typed events
- DLQ flow: task fails maxRetries → appears in `getDLQ()`
- `retryFromDLQ()` requeues single task from DLQ
- `retryAllFromDLQ()` requeues all tasks from DLQ
- `purgeDLQ()` clears DLQ

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Define VorqConfig**

In `packages/core/src/vorq.ts` (co-located with Vorq class):

```ts
import type { TransportAdapter, QueueOptions } from "./transport/types.js";
import type { StorageAdapter } from "./persistence/types.js";
import type { VorqLogger } from "./logging/types.js";
import type { RetryPolicyConfig } from "./retry/retry-policy.js";
import type { Priority } from "./task/types.js";

export interface VorqConfig {
  transport: TransportAdapter;
  storage?: StorageAdapter;
  logger?: VorqLogger;
  defaults?: {
    retryPolicy?: RetryPolicyConfig;
    priority?: Priority;
    timeout?: number;
  };
}
```

- [ ] **Step 4: Implement Vorq facade**

Composes: QueueManager, WorkerPool factory, DAGResolver, CronScheduler, EventBus.

```ts
export class Vorq {
  private readonly transport: TransportAdapter;
  private readonly storage?: StorageAdapter;
  private readonly eventBus: EventBus;
  private readonly logger: VorqLogger;
  private readonly queueManager: QueueManager;
  private readonly dagResolver: DAGResolver;
  private readonly scheduler: CronScheduler;
  private readonly workers: Map<string, WorkerPool[]>;
  private readonly defaults: VorqConfig["defaults"];
  private started = false;

  constructor(config: VorqConfig) {
    // Wire up: logger (default ConsoleLogger), eventBus, dagResolver, queueManager, scheduler
    // If storage provided: create PersistenceListener and register on eventBus
    // Register DAG integration listener on eventBus (see Step 5)
  }

  async start(): Promise<void> { /* connect transport, start scheduler, start all workers */ }
  async shutdown(timeout?: number): Promise<void> { /* stop scheduler, stop workers, disconnect */ }

  createQueue(name: string, options?: QueueOptions): QueueHandle { /* delegate to queueManager */ }

  async enqueue<T>(queue: string, task: TaskDefinition<T>): Promise<string> {
    // 1. Generate ID via crypto.randomUUID()
    // 2. If task.options.dependsOn:
    //    a. Validate: if transport is not InMemoryTransport && no storage → throw VorqError
    //    b. Add to dagResolver
    //    c. Store task internally with WAITING status
    //    d. Emit task.enqueued (for persistence)
    //    e. Do NOT publish to transport yet — wait for dependencies
    // 3. If no dependencies:
    //    a. Build TaskMessage from TaskDefinition
    //    b. Emit task.enqueued
    //    c. Publish to transport
    // 4. Return task ID
  }

  async enqueueBatch(queue: string, tasks: TaskDefinition[]): Promise<string[]> {
    // Map over tasks, call enqueue() for each, return IDs
  }

  registerWorker(queue: string, handler: TaskHandler, options?: WorkerOptions): WorkerHandle {
    // Create new WorkerPool for this handler
    // Add to workers Map (queue → WorkerPool[])
    // Multiple registerWorker() calls for same queue = multiple WorkerPools
    // Return WorkerHandle wrapping the pool
  }

  schedule(queue: string, cron: string, task: TaskDefinition, options?: ScheduleOptions): string {
    // Delegate to scheduler.register()
    // Throws VorqError on invalid cron (cron-parser validates)
  }

  async getDLQ(queue: string): Promise<DeadLetterRecord[]> { /* read from dlq:{queue} */ }
  async retryFromDLQ(taskId: string): Promise<void> { /* remove from DLQ, re-enqueue */ }
  async retryAllFromDLQ(queue: string): Promise<void> { /* drain DLQ, re-enqueue all */ }
  async purgeDLQ(queue: string): Promise<void> { /* clear dlq:{queue} */ }

  on<E extends keyof VorqEventMap>(event: E, listener: (data: VorqEventMap[E]) => void): void {
    // Delegate to eventBus.on()
  }
}
```

- [ ] **Step 5: Implement DAG + EventBus integration**

This is the critical wiring that connects DAG resolution to task execution:

```ts
// Inside Vorq constructor — register DAG listener:
this.eventBus.on("task.completed", async (data) => {
  const readyTaskIds = this.dagResolver.resolve(data.taskId);
  for (const taskId of readyTaskIds) {
    const waitingTask = this.waitingTasks.get(taskId);
    if (!waitingTask) continue;
    this.waitingTasks.delete(taskId);
    // Build TaskMessage from stored task definition
    // Publish to transport
  }
});

this.eventBus.on("task.failed", async (data) => {
  // Check if task has exhausted retries (is being dead-lettered)
  // If so, abandon all downstream:
  const abandonedIds = this.dagResolver.abandon(data.taskId);
  for (const taskId of abandonedIds) {
    this.waitingTasks.delete(taskId);
    await this.eventBus.emit("task.abandoned", {
      taskId,
      queue: data.queue,
      reason: `Dependency ${data.taskId} failed`,
    });
  }
});
```

The `waitingTasks: Map<string, { queue: string; task: TaskDefinition }>` stores tasks with unmet dependencies. When all dependencies are met, the task is published to the transport.

- [ ] **Step 6: Run tests — verify pass**

---

### Task 18: Update core/src/index.ts — Public API

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Export all public types and classes**

```ts
export { Vorq } from "./vorq.js";
export type { VorqConfig } from "./vorq.js";

export {
  Priority,
  TaskStatus,
  type BackoffStrategy,
  type TaskDefinition,
  type TaskOptions,
  type TaskRecord,
  type TaskAttemptRecord,
  type DeadLetterRecord,
} from "./task/index.js";

export {
  type TransportAdapter,
  type TaskMessage,
  type MessageEnvelope,
  type MessageHandler,
  type PublishOptions,
  type QueueOptions,
  type RateLimiterOptions,
} from "./transport/index.js";

export { InMemoryTransport } from "./transport/in-memory-transport.js";

export {
  type StorageAdapter,
  type TaskFilter,
  type QueueMetrics,
} from "./persistence/index.js";

export type { VorqLogger } from "./logging/index.js";
export { ConsoleLogger } from "./logging/index.js";

export type { VorqEventMap, VorqEvent } from "./events/index.js";
export { EventBus } from "./events/index.js";

export type { TaskHandler } from "./worker/index.js";
export type { TaskContext, WorkerOptions, WorkerHandle } from "./worker/index.js";
export type { QueueHandle } from "./queue/index.js";
export type { ScheduleOptions } from "./scheduler/index.js";

export {
  RetryPolicy,
  type RetryPolicyConfig,
  FixedBackoff,
  ExponentialBackoff,
  ExponentialJitterBackoff,
} from "./retry/index.js";

export { DAGResolver } from "./dag/index.js";

export {
  VorqError,
  TransportError,
  TaskTimeoutError,
  CyclicDependencyError,
  QueueNotFoundError,
  TaskNotFoundError,
  ShutdownError,
} from "./errors/index.js";
```

- [ ] **Step 2: Verify build**

Run: `npx turbo run build --filter=@vorq/core`
Expected: Build succeeds with all exports.

- [ ] **Step 3: Verify all tests pass**

Run: `npx turbo run test --filter=@vorq/core`
Expected: All tests pass.

---

## Phase 4: Transport Adapters

### Task 19: Docker Compose for Development

**Files:**
- Create: `docker-compose.yml` (root level — shared by all packages)

- [ ] **Step 1: Create docker-compose.yml**

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  rabbitmq:
    image: rabbitmq:3-management-alpine
    ports:
      - "5672:5672"
      - "15672:15672"

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: vorq
      POSTGRES_PASSWORD: vorq
      POSTGRES_DB: vorq
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

- [ ] **Step 2: Verify services start**

Run: `docker compose up -d`
Expected: All 3 services running.

---

### Task 20: Transport Contract Test Suite

**Files:**
- Create: `packages/core/src/transport/transport-contract.test-suite.ts`

- [ ] **Step 1: Create shared abstract test suite**

A reusable test factory that validates any `TransportAdapter` implementation. Both Redis and RabbitMQ tests will import and run this suite with their specific adapter.

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { TransportAdapter } from "./types.js";
import { TransportError } from "../errors/index.js";
import { Priority } from "../task/types.js";

export function transportContractTests(
  name: string,
  factory: () => Promise<TransportAdapter>,
  cleanup: (transport: TransportAdapter) => Promise<void>,
) {
  describe(`TransportAdapter contract: ${name}`, () => {
    let transport: TransportAdapter;

    beforeEach(async () => { transport = await factory(); });
    afterEach(async () => { await cleanup(transport); });

    it("connect/disconnect/isConnected lifecycle", async () => { /* ... */ });
    it("createQueue/deleteQueue", async () => { /* ... */ });
    it("publish + subscribe delivers message", async () => { /* ... */ });
    it("acknowledge removes message", async () => { /* ... */ });
    it("reject with requeue redelivers", async () => { /* ... */ });
    it("reject without requeue discards", async () => { /* ... */ });
    it("publish throws TransportError when disconnected", async () => { /* ... */ });
    it("priority ordering", async () => { /* ... */ });
    it("delayed tasks", async () => { /* ... */ });
  });
}
```

- [ ] **Step 2: Verify InMemoryTransport passes contract tests**

Add to `in-memory-transport.test.ts`:
```ts
import { transportContractTests } from "./transport-contract.test-suite.js";
import { InMemoryTransport } from "./in-memory-transport.js";

transportContractTests(
  "InMemoryTransport",
  async () => { const t = new InMemoryTransport(); await t.connect(); return t; },
  async (t) => { await t.disconnect(); },
);
```

---

### Task 21: @vorq/redis — RedisTransport

**Files:**
- Create: `packages/redis/src/redis-transport.ts`
- Create: `packages/redis/src/redis-streams.ts`
- Create: `packages/redis/src/redis-transport.test.ts`
- Create: `packages/redis/src/index.ts`

- [ ] **Step 1: Write tests**

Import and run the shared contract test suite + Redis-specific tests:

```ts
import { transportContractTests } from "@vorq/core/transport/transport-contract.test-suite.js";
import { RedisTransport } from "./redis-transport.js";

transportContractTests(
  "RedisTransport",
  async () => { const t = new RedisTransport({ host: "localhost" }); await t.connect(); return t; },
  async (t) => { await t.disconnect(); },
);
```

Additional Redis-specific tests:
- Consumer groups for horizontal scaling
- Reconnection — recovers after connection drop
- Delayed task polling loop moves ready tasks

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement RedisTransport**

Uses `ioredis`. Key design:
- Each queue = Redis Stream + sorted set for priority index
- Consumer groups for horizontal scaling
- Delayed tasks: sorted set `vorq:delayed:{queue}` with score = execute_at timestamp
- Polling loop moves ready delayed tasks to main stream
- Priority: separate sorted set `vorq:priority:{queue}`, ZPOPMIN to get highest priority
- `acknowledge()`: XACK on consumer group
- `reject(requeue=true)`: re-publish to queue
- Auto-reconnect via ioredis built-in reconnection

`redis-streams.ts`: Low-level Redis Streams helpers (XADD, XREADGROUP, XACK, consumer group management).

- [ ] **Step 4: Run tests — verify pass**

Run: `docker compose up -d redis && npx vitest run --config packages/redis/vitest.config.ts`

---

### Task 22: @vorq/rabbitmq — RabbitMQTransport

**Files:**
- Create: `packages/rabbitmq/src/rabbitmq-transport.ts`
- Create: `packages/rabbitmq/src/exchange-manager.ts`
- Create: `packages/rabbitmq/src/rabbitmq-transport.test.ts`
- Create: `packages/rabbitmq/src/index.ts`

- [ ] **Step 1: Write tests**

Import and run the shared contract test suite + RabbitMQ-specific tests:

```ts
import { transportContractTests } from "@vorq/core/transport/transport-contract.test-suite.js";
import { RabbitMQTransport } from "./rabbitmq-transport.js";

transportContractTests(
  "RabbitMQTransport",
  async () => { const t = new RabbitMQTransport({ url: "amqp://localhost" }); await t.connect(); return t; },
  async (t) => { await t.disconnect(); },
);
```

Additional RabbitMQ-specific tests:
- Priority via `x-max-priority`
- Delayed tasks via dead letter exchange with TTL
- Consumer prefetch count
- Reconnection on connection drop

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement RabbitMQTransport**

Uses `amqplib`. Key design:
- Each queue = RabbitMQ queue with `x-max-priority`
- Delayed tasks: delay exchange with per-message TTL → dead-letter to main queue
- `exchange-manager.ts`: creates exchanges, bindings, delay infrastructure
- `acknowledge()`: `channel.ack(msg)`
- `reject(requeue)`: `channel.nack(msg, false, requeue)`
- Reconnection: wrap channel operations, detect disconnection, retry with backoff

- [ ] **Step 4: Run tests — verify pass**

Run: `docker compose up -d rabbitmq && npx vitest run --config packages/rabbitmq/vitest.config.ts`

---

## Phase 5: Persistence

### Task 23: PrismaStorage

**Files:**
- Create: `packages/core/src/persistence/prisma-storage.ts`
- Create: `packages/core/src/persistence/prisma-storage.test.ts`
- Create: `packages/core/prisma/schema.prisma`

- [ ] **Step 1: Create Prisma schema**

Copy schema from spec (Task, TaskDependency, TaskAttempt models, TaskStatus enum). Add datasource and generator config.

- [ ] **Step 2: Install Prisma dependencies**

Run: `cd packages/core && npm install prisma @prisma/client --save-dev`

- [ ] **Step 3: Generate Prisma client**

Run: `cd packages/core && npx prisma generate`

- [ ] **Step 4: Write tests**

Integration tests (require Postgres via Docker):
- `saveTask()` inserts task record
- `updateTask()` updates specific fields
- `getTask()` returns task by ID, null if not found
- `queryTasks()` filters by queue, status, name, date range
- `queryTasks()` pagination (limit, offset)
- `queryTasks()` ordering
- `getMetrics()` returns correct counts

- [ ] **Step 5: Run test — verify it fails**

- [ ] **Step 6: Implement PrismaStorage**

Implements `StorageAdapter`. Wraps `PrismaClient` operations. Maps between `TaskRecord` (domain) and Prisma models.

**Prisma distribution strategy:** `PrismaStorage` accepts a `PrismaClient` instance in its constructor — the consumer generates the client with Vorq's schema. The Prisma schema file is shipped in the npm package under `prisma/schema.prisma`. Users copy it or extend their own schema. Document this in README: `npx prisma db push --schema node_modules/@vorq/core/prisma/schema.prisma`.

- [ ] **Step 7: Run tests — verify pass**

Run: `docker compose up -d postgres && cd packages/core && npx prisma db push && npx vitest run src/persistence/`

---

### Task 24: Persistence EventBus Integration

**Files:**
- Create: `packages/core/src/persistence/persistence-listener.ts`
- Create: `packages/core/src/persistence/persistence-listener.test.ts`

- [ ] **Step 1: Write tests**

Test cases using InMemoryTransport + mock StorageAdapter:
- `task.enqueued` event → `saveTask()` called with correct data
- `task.active` event → `updateTask()` with startedAt
- `task.completed` event → `updateTask()` with result, completedAt
- `task.failed` event → `updateTask()` with error
- `task.progress` event → `updateTask()` with progress
- StorageAdapter error does not throw — logs warning
- Integration test: StorageAdapter throws on `saveTask()`, but task still completes successfully (persistence failure does not block execution)

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement PersistenceListener**

Class that subscribes to EventBus events and calls StorageAdapter methods. Wraps each call in try/catch, logs errors.

```ts
export class PersistenceListener {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly eventBus: EventBus,
    private readonly logger: VorqLogger,
  ) {}

  register(): void {
    this.eventBus.on("task.enqueued", (data) => this.onEnqueued(data));
    this.eventBus.on("task.active", (data) => this.onActive(data));
    // ... etc
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

---

## Phase 6: NestJS Integration

### Task 25: @vorq/nestjs — VorqModule & Decorators

**Files:**
- Create: `packages/nestjs/src/vorq.module.ts`
- Create: `packages/nestjs/src/vorq.service.ts`
- Create: `packages/nestjs/src/decorators/worker.decorator.ts`
- Create: `packages/nestjs/src/decorators/task.decorator.ts`
- Create: `packages/nestjs/src/decorators/scheduled.decorator.ts`
- Create: `packages/nestjs/src/decorators/index.ts`
- Create: `packages/nestjs/src/providers/index.ts`
- Create: `packages/nestjs/src/vorq.module.test.ts`
- Create: `packages/nestjs/src/index.ts`

- [ ] **Step 1: Install NestJS dev dependencies**

Run: `cd packages/nestjs && npm install @nestjs/common @nestjs/core @nestjs/testing reflect-metadata rxjs --save-dev`

- [ ] **Step 2: Write tests**

Test using `@nestjs/testing` TestingModule:
- `VorqModule.forRoot()` registers Vorq as provider
- `VorqService` is injectable
- `VorqService.enqueue()` delegates to Vorq
- `@Worker()` decorator stores metadata
- `@Task()` decorator stores metadata
- `@Scheduled()` decorator stores metadata
- Module auto-discovers `@Worker()` classes and registers handlers on init
- Module calls `vorq.shutdown()` on destroy

- [ ] **Step 3: Run test — verify it fails**

- [ ] **Step 4: Implement decorators**

Use `Reflect.defineMetadata` to store worker queue name, task name, schedule cron expression.

`worker.decorator.ts`:
```ts
import { SetMetadata } from "@nestjs/common";
export const VORQ_WORKER_QUEUE = "VORQ_WORKER_QUEUE";
export const Worker = (queue: string) => SetMetadata(VORQ_WORKER_QUEUE, queue);
```

`task.decorator.ts`:
```ts
export const VORQ_TASK_NAME = "VORQ_TASK_NAME";
export const Task = (name: string): MethodDecorator =>
  (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(VORQ_TASK_NAME, name, descriptor.value!);
    return descriptor;
  };
```

`scheduled.decorator.ts`:
```ts
export const VORQ_SCHEDULE_CRON = "VORQ_SCHEDULE_CRON";
export const Scheduled = (cron: string): MethodDecorator =>
  (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(VORQ_SCHEDULE_CRON, cron, descriptor.value!);
    return descriptor;
  };
```

- [ ] **Step 5: Implement VorqModule**

`forRoot()`: creates Vorq instance as provider, registers scanner for `@Worker()` decorated classes.
`forRootAsync()`: supports factory pattern for async config.

On `OnModuleInit`: scan all providers for `@Worker()` metadata, for each `@Task()` method call `vorq.registerWorker()`, for each `@Scheduled()` method call `vorq.schedule()`. Call `vorq.start()`.

On `OnModuleDestroy`: call `vorq.shutdown()`.

- [ ] **Step 6: Implement VorqService**

Thin injectable wrapper around Vorq facade.

- [ ] **Step 7: Run tests — verify pass**

---

**Note on rate limiting:** `QueueOptions.rateLimiter` is defined in the types but the actual token bucket implementation is transport-specific. For v1.0, rate limiting works only with Redis transport (Lua script). The `RedisTransport` exposes a `checkRateLimit()` method that workers call before processing. RabbitMQ transport ignores the option and logs a warning. Full rate limiter implementation is added as a step in Task 21 (RedisTransport).

---

## Phase 7: Example App & Final Polish

### Task 26: Example Demo Application

**Files:**
- Create: `examples/demo-app/package.json`
- Create: `examples/demo-app/src/index.ts`
- Create: `examples/demo-app/src/workers.ts`
- Create: `examples/demo-app/README.md`

- [ ] **Step 1: Create demo app**

Simple standalone TypeScript script demonstrating:
1. Create Vorq instance with Redis transport
2. Create a queue
3. Register workers
4. Enqueue tasks with priorities
5. Enqueue delayed task
6. Enqueue tasks with DAG dependencies
7. Schedule a cron task
8. Listen to events and log
9. Graceful shutdown

- [ ] **Step 2: Verify demo app runs**

Run: `docker compose up -d && cd examples/demo-app && npx tsx src/index.ts`
Expected: Tasks processed, events logged, clean shutdown.

---

### Task 27: Root README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

Sections:
- Logo/badge area (npm version, license, CI status)
- One-line description
- Features list
- Quick start (install, minimal example)
- Packages table
- API overview (enqueue, worker, schedule, DAG)
- Configuration
- Transport adapters
- Persistence
- NestJS integration
- Testing
- Contributing
- License

---

### Task 28: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create CI workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
      rabbitmq:
        image: rabbitmq:3-alpine
        ports: ["5672:5672"]
      postgres:
        image: postgres:16-alpine
        ports: ["5432:5432"]
        env:
          POSTGRES_USER: vorq
          POSTGRES_PASSWORD: vorq
          POSTGRES_DB: vorq
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
```

---

### Task 29: Final Integration Test

**Files:**
- Create: `packages/core/src/vorq.integration.test.ts`

- [ ] **Step 1: Write end-to-end integration test**

Full lifecycle test using InMemoryTransport:
1. Create Vorq instance
2. Create queue, register worker
3. Enqueue task → worker processes → completed event fires
4. Enqueue failing task → retries → DLQ
5. Enqueue DAG tasks → correct execution order
6. Schedule task → scheduler ticks → task enqueued
7. Graceful shutdown — all clean

- [ ] **Step 2: Run full test suite**

Run: `npx turbo run test`
Expected: All tests across all packages pass.

- [ ] **Step 3: Run full build**

Run: `npx turbo run build`
Expected: All packages build cleanly.

- [ ] **Step 4: Run linter**

Run: `npx biome check .`
Expected: No errors.
