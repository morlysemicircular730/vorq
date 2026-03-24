import { Priority, Vorq } from "@vorq/core";
import { RedisTransport } from "@vorq/redis";

async function main() {
  const transport = new RedisTransport({ host: "localhost", port: 6379 });
  const vorq = new Vorq({ transport });

  await vorq.createQueue("tasks");

  vorq.registerWorker("tasks", async (ctx) => {
    console.log(`Processing: ${ctx.name}`, ctx.payload);
    return { ok: true };
  });

  vorq.on("task.completed", (data) => {
    console.log(`Completed: ${data.taskId} in ${data.duration}ms`);
  });

  await vorq.start();

  await vorq.enqueue("tasks", {
    name: "hello-redis",
    payload: { message: "Hello from Vorq!" },
    options: { priority: Priority.HIGH },
  });

  await new Promise((r) => setTimeout(r, 2000));

  await vorq.shutdown();
  console.log("Done!");
}

main().catch(console.error);
