import { InMemoryTransport, Priority, Vorq } from "@vorq/core";

async function main() {
  const transport = new InMemoryTransport();
  const vorq = new Vorq({ transport });

  await vorq.createQueue("emails");
  await vorq.createQueue("processing");

  vorq.registerWorker("emails", async (ctx) => {
    console.log(`[Worker] Processing email task: ${ctx.name}`, ctx.payload);
    await ctx.progress(50);
    await new Promise((r) => setTimeout(r, 100));
    await ctx.progress(100);
    return { sent: true };
  });

  vorq.registerWorker("processing", async (ctx) => {
    console.log(`[Worker] Processing data task: ${ctx.name}`, ctx.payload);
    return { processed: true };
  });

  vorq.on("task.completed", (data) => {
    console.log(`[Event] Task completed: ${data.taskId} (${data.duration}ms)`);
  });

  vorq.on("task.failed", (data) => {
    console.log(`[Event] Task failed: ${data.taskId}`, data.error.message);
  });

  await vorq.start();

  const id1 = await vorq.enqueue("emails", {
    name: "send-welcome",
    payload: { userId: 1, email: "user@example.com" },
    options: { priority: Priority.HIGH },
  });
  console.log(`[Enqueue] Welcome email: ${id1}`);

  const id2 = await vorq.enqueue("emails", {
    name: "send-newsletter",
    payload: { campaignId: 42 },
    options: { priority: Priority.LOW },
  });
  console.log(`[Enqueue] Newsletter: ${id2}`);

  const fetchId = await vorq.enqueue("processing", {
    name: "fetch-data",
    payload: { url: "https://api.example.com/data" },
  });

  const transformId = await vorq.enqueue("processing", {
    name: "transform-data",
    payload: { format: "csv" },
    options: { dependsOn: [fetchId] },
  });
  console.log(`[DAG] fetch:${fetchId} → transform:${transformId}`);

  const scheduleId = vorq.schedule("processing", "*/5 * * * *", {
    name: "cleanup",
    payload: { olderThan: "24h" },
  });
  console.log(`[Schedule] Cleanup every 5 min: ${scheduleId}`);

  await transport.drain("emails");
  await transport.drain("processing");

  await new Promise((r) => setTimeout(r, 500));

  await transport.drain("processing");
  await new Promise((r) => setTimeout(r, 500));

  console.log("\n[Done] Shutting down...");
  await vorq.shutdown();
  console.log("[Done] Clean shutdown complete.");
}

main().catch(console.error);
