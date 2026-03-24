# Vorq — Distributed Task Queue for TypeScript

## Overview

Vorq is a distributed task queue library for TypeScript. Framework-agnostic core with pluggable transport (Redis/RabbitMQ), optional PostgreSQL persistence, and a NestJS integration adapter.

**Distribution model:** Library-first (npm packages), not an application.

**Packages:**

- `@vorq/core` — queue engine, workers, retry/DLQ, DAG, scheduler, persistence interface
- `@vorq/redis` — Redis transport adapter
- `@vorq/rabbitmq` — RabbitMQ transport adapter
- `@vorq/nestjs` — NestJS module, decorators, DI integration

## Monorepo Structure

```
vorq/
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── task/             # TaskDefinition, TaskRecord, TaskStatus, TaskBuilder
│   │   │   ├── queue/            # QueueManager, QueueOptions
│   │   │   ├── worker/           # WorkerPool, Semaphore, TaskContext
│   │   │   ├── retry/            # RetryPolicy, BackoffStrategy implementations, DLQ
│   │   │   ├── dag/              # DAGResolver, CyclicDependencyError
│   │   │   ├── scheduler/        # CronScheduler, ScheduleRegistry, overlap protection
│   │   │   ├── persistence/      # StorageAdapter interface, PrismaStorage
│   │   │   ├── transport/        # TransportAdapter interface, InMemoryTransport
│   │   │   ├── events/           # EventBus, VorqEvent types
│   │   │   ├── errors/           # VorqError hierarchy
│   │   │   ├── logging/          # VorqLogger interface, ConsoleLogger
│   │   │   └── vorq.ts           # Vorq facade class
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── redis/
│   │   ├── src/
│   │   │   ├── redis-transport.ts
│   │   │   ├── redis-streams.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── rabbitmq/
│   │   ├── src/
│   │   │   ├── rabbitmq-transport.ts
│   │   │   ├── exchange-manager.ts
│   │   │   └── index.ts
│   │   └── package.json
│   └── nestjs/
│       ├── src/
│       │   ├── vorq.module.ts
│       │   ├── decorators/
│       │   ├── providers/
│       │   └── index.ts
│       └── package.json
├── examples/
│   └── demo-app/
│       ├── src/
│       ├── docker-compose.yml
│       └── package.json
├── turbo.json
├── package.json
├── tsconfig.base.json
├── biome.json
├── .github/workflows/
├── LICENSE
└── README.md
```

## Core Architecture

```
┌─────────────────────────────────────────────────┐
│                    Vorq (Facade)                 │
├─────────────────────────────────────────────────┤
│  QueueManager  │  WorkerPool  │  CronScheduler  │
├─────────────────────────────────────────────────┤
│                   EventBus                       │
├─────────────────────────────────────────────────┤
│  RetryPolicy   │ DAGResolver  │ StorageAdapter  │
│    + DLQ       │              │   (optional)    │
├─────────────────────────────────────────────────┤
│            TransportAdapter (interface)           │
└─────────────────────────────────────────────────┘
         │                          │
    @vorq/redis              @vorq/rabbitmq
```

### Key Interfaces

#### TransportAdapter

Contract for message brokers:

```ts
interface TransportAdapter {
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

Transport reconnection: adapters implement automatic reconnection with exponential backoff. During disconnection, `publish()` throws `TransportError`. Workers pause consuming and resume on reconnect.

#### TaskMessage & MessageEnvelope

```ts
interface TaskMessage {
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

interface MessageEnvelope {
  messageId: string;
  task: TaskMessage;
  receivedAt: number;
}

type MessageHandler = (envelope: MessageEnvelope) => Promise<void>;

type TaskHandler<T = unknown, R = unknown> = (context: TaskContext<T>) => Promise<R>;
```

#### PublishOptions & QueueOptions

```ts
interface PublishOptions {
  priority?: Priority;
  delay?: number;
  messageId?: string;
}

interface QueueOptions {
  maxPriority?: number;
  deadLetterQueue?: string;
  messageTtl?: number;
  maxLength?: number;
  rateLimiter?: RateLimiterOptions;
}

interface RateLimiterOptions {
  maxPerInterval: number;
  interval: number;
}
```

`QueueOptions` defines transport-agnostic queue configuration. Transport adapters map these to their native equivalents (Redis sorted set config, RabbitMQ queue arguments).

#### StorageAdapter

Contract for persistence:

```ts
interface TaskRecord {
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

interface StorageAdapter {
  saveTask(task: TaskRecord): Promise<void>;
  updateTask(id: string, update: Partial<TaskRecord>): Promise<void>;
  getTask(id: string): Promise<TaskRecord | null>;
  queryTasks(filter: TaskFilter): Promise<TaskRecord[]>;
  getMetrics(queue?: string): Promise<QueueMetrics>;
}

interface TaskFilter {
  queue?: string;
  status?: TaskStatus | TaskStatus[];
  name?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'completedAt';
  order?: 'asc' | 'desc';
}

interface QueueMetrics {
  pending: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  avgDuration: number;
  throughput: number;
}
```

#### VorqLogger

```ts
interface VorqLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}
```

#### VorqConfig

```ts
interface VorqConfig {
  transport: TransportAdapter;
  storage?: StorageAdapter;
  logger?: VorqLogger;
  defaults?: {
    retryPolicy?: RetryPolicy;
    priority?: Priority;
    timeout?: number;
  };
}
```

### Vorq Facade

```ts
class Vorq {
  constructor(config: VorqConfig);

  createQueue(name: string, options?: QueueOptions): QueueHandle;

  enqueue<T>(queue: string, task: TaskDefinition<T>): Promise<string>;
  enqueueBatch(queue: string, tasks: TaskDefinition[]): Promise<string[]>;
  schedule(queue: string, cron: string, task: TaskDefinition, options?: ScheduleOptions): string;

  registerWorker(queue: string, handler: TaskHandler, options?: WorkerOptions): WorkerHandle;

  getDLQ(queue: string): Promise<DeadLetterRecord[]>;
  retryFromDLQ(taskId: string): Promise<void>;
  retryAllFromDLQ(queue: string): Promise<void>;
  purgeDLQ(queue: string): Promise<void>;

  start(): Promise<void>;
  shutdown(timeout?: number): Promise<void>;

  on<E extends keyof VorqEventMap>(event: E, listener: (data: VorqEventMap[E]) => void): void;
}

interface QueueHandle {
  name: string;
  enqueue<T>(task: TaskDefinition<T>): Promise<string>;
  pause(): Promise<void>;
  resume(): Promise<void>;
}

interface WorkerHandle {
  pause(): void;
  resume(): void;
  isRunning(): boolean;
}

interface ScheduleOptions {
  overlap?: boolean;
}
```

### Typed Events

```ts
interface VorqEventMap {
  'task.enqueued': { taskId: string; queue: string };
  'task.active': { taskId: string; queue: string; attempt: number };
  'task.completed': { taskId: string; queue: string; result: unknown; duration: number };
  'task.failed': { taskId: string; queue: string; error: Error; attempt: number };
  'task.retrying': { taskId: string; queue: string; attempt: number; nextDelay: number };
  'task.deadLettered': { taskId: string; queue: string; error: Error; attempts: number };
  'task.abandoned': { taskId: string; queue: string; reason: string };
  'task.progress': { taskId: string; queue: string; percent: number };
}
```

EventBus error handling: listener errors are caught and logged via VorqLogger. A failing persistence listener does not affect task execution.

## Task Model

```ts
interface TaskDefinition<TPayload = unknown, TResult = unknown> {
  name: string;
  payload: TPayload;
  options?: TaskOptions;
}

interface TaskOptions {
  priority?: Priority;
  delay?: number;
  maxRetries?: number;
  backoff?: BackoffStrategy;
  timeout?: number;
  dependsOn?: string[];
}

enum Priority {
  CRITICAL = 0,
  HIGH = 1,
  MEDIUM = 2,
  LOW = 3,
}
```

### Task Lifecycle

```
PENDING → QUEUED → ACTIVE → COMPLETED
                      │
                      ├→ RETRYING → QUEUED
                      │
                      └→ FAILED → DLQ

WAITING → (dependencies met) → PENDING
WAITING → (dependency failed) → ABANDONED
```

## Queue Engine

### Priority Implementation

- **Redis:** sorted sets (ZADD with score = priority + timestamp)
- **RabbitMQ:** native priority queues (`x-max-priority`)

Abstracted by TransportAdapter — `PublishOptions.priority` handled by each adapter.

### Delayed Tasks

- **Redis:** sorted set with score = `now + delay`, polling loop every 500ms moves ready tasks to work queue
- **RabbitMQ:** dead letter exchange with TTL, native mechanism

### Rate Limiting (optional per queue)

Configured via `QueueOptions.rateLimiter`. Token bucket in Redis via atomic Lua script. Rate limiting is enforced at consume time — workers check the limiter before processing each task.

## Worker Pool

### WorkerOptions

```ts
interface WorkerOptions {
  concurrency: number;        // default: 1
  pollInterval: number;       // default: 1000ms
  lockDuration: number;       // default: 30000ms — max time a task can be held before redelivery
  batchSize: number;          // default: 1
}
```

`lockDuration` is the visibility timeout: once a worker picks up a task, it has `lockDuration` ms to complete it. If the lock expires (worker crashed or task hung), the broker redelivers the task to another worker. Workers extend the lock automatically for long-running tasks via a heartbeat interval at `lockDuration / 2`.

### TaskContext

```ts
interface TaskContext<T> {
  id: string;
  name: string;
  payload: T;
  attempt: number;
  progress(percent: number): Promise<void>;
  log(message: string): void;
  signal: AbortSignal;
}
```

### Concurrency

Async semaphore pattern — no threads/processes. Suitable for I/O-bound tasks.

### Graceful Shutdown

1. `vorq.shutdown(timeout)` called
2. Workers stop accepting new tasks
3. Wait for current tasks (up to timeout)
4. AbortSignal cancels remaining tasks
5. Unfinished tasks requeued via reject + requeue
6. Transport disconnects

### Horizontal Scaling

Multiple instances connect to the same broker. No inter-instance coordination needed — broker guarantees single delivery:

- Redis: consumer groups or atomic BRPOPLPUSH
- RabbitMQ: single queue, multiple consumers with prefetch count

## Retry & Dead Letter Queue

### RetryPolicy

```ts
interface RetryPolicy {
  maxRetries: number;
  backoff: BackoffStrategy;
  retryableErrors?: string[];
}

interface BackoffStrategy {
  calculate(attempt: number): number;
}
```

### Built-in Backoff Strategies

- `FixedBackoff` — constant delay
- `ExponentialBackoff(base, maxDelay)` — 1s, 2s, 4s, 8s...
- `ExponentialJitterBackoff` — exponential + random jitter (default, prevents thundering herd)
- Custom — user implements `BackoffStrategy`

### Retry Flow

1. Task fails with error
2. RetryPolicy checks `attempt < maxRetries`
3. Yes → calculate delay via BackoffStrategy, requeue as delayed task
4. No → move to DLQ

### Retry Timeline (3-attempt example)

```
Attempt 1:
  status: QUEUED → ACTIVE → (error) → RETRYING
  events: task.active → task.failed → task.retrying
  persistence: UPDATE status=ACTIVE, startedAt → INSERT TaskAttempt(attempt=1, error) → UPDATE status=RETRYING
  Task.attempt incremented to 1
  backoff: ExponentialJitter calculates delay (e.g. ~1s)
  task requeued as delayed → status becomes QUEUED after delay

Attempt 2:
  status: QUEUED → ACTIVE → (error) → RETRYING
  events: task.active → task.failed → task.retrying
  persistence: UPDATE status=ACTIVE → INSERT TaskAttempt(attempt=2, error) → UPDATE status=RETRYING
  Task.attempt incremented to 2
  backoff: ~2s + jitter

Attempt 3 (final):
  status: QUEUED → ACTIVE → (error) → FAILED
  events: task.active → task.failed → task.deadLettered
  persistence: UPDATE status=ACTIVE → INSERT TaskAttempt(attempt=3, error) → UPDATE status=FAILED
  Task moved to DLQ
```

During backoff delay, task status is RETRYING. It transitions to QUEUED when the delay expires and the task re-enters the broker queue.

### Dead Letter Queue

Separate queue per source queue with `dlq:` prefix. Stores full attempt history.

```ts
interface DeadLetterRecord {
  taskId: string;
  queue: string;
  payload: unknown;
  error: string;
  attempts: number;
  failedAt: Date;
  history: TaskAttemptRecord[];
}
```

```ts
interface TaskAttemptRecord {
  attempt: number;
  error: string;
  startedAt: Date;
  duration: number;
}
```

User can inspect, retry individual tasks, retry all, or purge DLQ.

## Task Dependencies (DAG)

### Usage

```ts
const a = await vorq.enqueue('q', { name: 'fetch', payload: {} });
const b = await vorq.enqueue('q', { name: 'transform', payload: {}, options: { dependsOn: [a] } });
const c = await vorq.enqueue('q', { name: 'upload', payload: {}, options: { dependsOn: [a, b] } });
```

### DAGResolver

- Validates acyclicity on task addition (topological sort, O(V+E))
- Throws `CyclicDependencyError` on cycles
- On `task.completed` — checks which dependent tasks are now ready
- On `task.failed`/DLQ — marks all downstream as `ABANDONED`

### Storage

- Without persistence: in-memory Map (single instance only, lost on restart). Using `dependsOn` without persistence logs a warning at startup.
- With persistence: PostgreSQL `TaskDependency` table, restored on startup, works with horizontal scaling.
- Multi-instance without persistence: `dependsOn` throws `VorqError` because cross-instance DAG coordination requires shared state. Detected when transport is not InMemoryTransport and no storage is configured.

### Constraints

- Max DAG depth: 100
- No result passing between tasks (v1.1)
- No partial DAG execution — failed dependency abandons all downstream

## Scheduler

### Usage

```ts
vorq.schedule('queue', '*/5 * * * *', { name: 'task', payload: {} });
```

### CronScheduler

- Tick loop every 30 seconds
- Cron parsing via `cron-parser` library
- On tick: if `nextRun <= now` → enqueue task, update lastRun/nextRun

### Distributed Deduplication

Multiple instances must not create duplicate scheduled tasks:

- With persistence: PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED`
- Without persistence but with Redis transport: Redis `SET NX EX`
- InMemoryTransport (testing): single-instance assumed, no coordination
- RabbitMQ transport without persistence: Redis sidecar required for schedule locking, or user must ensure single scheduler instance

Lock key: `vorq:schedule:{scheduleId}:lock`, TTL = schedule interval.

`schedule()` validates the cron expression synchronously and throws `VorqError` if invalid.

### Overlap Protection

```ts
vorq.schedule('queue', '*/5 * * * *', task, { overlap: false });
```

Default `overlap: false` — skips if previous scheduled instance still ACTIVE.

## Persistence

Optional PostgreSQL via Prisma. Without storage config, everything works in-memory.

### Prisma Schema

```prisma
model Task {
  id          String      @id @default(uuid())
  queue       String
  name        String
  payload     Json
  status      TaskStatus
  priority    Int         @default(2)
  result      Json?
  error       String?
  attempt     Int         @default(0)
  maxRetries  Int         @default(3)
  progress    Int         @default(0)
  scheduleId  String?
  createdAt   DateTime    @default(now())
  startedAt   DateTime?
  completedAt DateTime?

  dependencies TaskDependency[] @relation("dependent")
  dependents   TaskDependency[] @relation("dependency")
  attempts     TaskAttempt[]

  @@index([queue, status])
  @@index([scheduleId])
  @@index([status, createdAt])
}

model TaskDependency {
  id           String @id @default(uuid())
  taskId       String
  dependsOnId  String
  task         Task   @relation("dependent", fields: [taskId])
  dependsOn    Task   @relation("dependency", fields: [dependsOnId])
  @@unique([taskId, dependsOnId])
}

model TaskAttempt {
  id        String   @id @default(uuid())
  taskId    String
  attempt   Int
  error     String?
  startedAt DateTime
  duration  Int
  task      Task     @relation(fields: [taskId])
  @@index([taskId])
}

enum TaskStatus {
  WAITING
  PENDING
  QUEUED
  ACTIVE
  COMPLETED
  FAILED
  RETRYING
  ABANDONED
}
```

### Write Strategy

Async writes on state transitions via EventBus. Persistence does not block task execution. If DB unavailable — log warning, tasks continue.

| Event | Action |
|-------|--------|
| task.enqueued | INSERT Task (status=PENDING, full record) |
| task.active | UPDATE status=ACTIVE, startedAt |
| task.progress | UPDATE progress field |
| task.completed | UPDATE status=COMPLETED, result, completedAt |
| task.failed | UPDATE status, error; INSERT TaskAttempt |
| task.retrying | UPDATE status=RETRYING |
| task.deadLettered | UPDATE status=FAILED |
| task.abandoned | UPDATE status=ABANDONED |

Task record is inserted at enqueue time (PENDING status), not at QUEUED. This ensures tasks are persisted before entering the broker, preventing data loss on crash.

## NestJS Integration (@vorq/nestjs)

### Module

```ts
@Module({})
class VorqModule {
  static forRoot(config: VorqConfig): DynamicModule;
  static forRootAsync(options: VorqAsyncOptions): DynamicModule;
}
```

### Decorators

```ts
@Worker('emails')
class EmailWorker {
  @Task('send-welcome')
  async handleWelcome(ctx: TaskContext<{ userId: number }>) { }

  @Scheduled('0 3 * * *')
  @Task('cleanup')
  async handleCleanup(ctx: TaskContext) { }
}
```

### VorqService

Injectable service wrapping Vorq facade for enqueueing tasks from any NestJS service.

### Scope

Thin adapter only — maps decorators to core API, integrates lifecycle (OnModuleInit/OnModuleDestroy), provides DI. Zero business logic.

## Error Handling

```ts
abstract class VorqError extends Error {
  abstract readonly code: string;
}

class TransportError extends VorqError { }
class TaskTimeoutError extends VorqError { }
class CyclicDependencyError extends VorqError { }
class QueueNotFoundError extends VorqError { }
class TaskNotFoundError extends VorqError { }
class ShutdownError extends VorqError { }
```

## Logging

`VorqLogger` interface — user provides their own (pino, winston). Default: `ConsoleLogger`.

## Testing

`InMemoryTransport` included in `@vorq/core` for unit tests — no broker required. Fully implements `TransportAdapter` contract (connect, subscribe, acknowledge, reject, createQueue, deleteQueue) with in-memory data structures. Additional test helpers:

```ts
const transport = new InMemoryTransport();
const vorq = new Vorq({ transport });

transport.getPublished('queue');
transport.drain('queue');
```

## Tooling

| Tool | Purpose |
|------|---------|
| Turborepo | Monorepo builds, caching |
| Biome | Linter + formatter |
| Vitest | Unit & integration tests |
| tsup | Bundle (ESM + CJS) |
| changesets | Versioning & changelogs |
| GitHub Actions | CI: lint → test → build |
| Docker Compose | Redis + RabbitMQ + Postgres for dev/tests |
