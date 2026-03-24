import { describe, expect, it } from "vitest";
import { Semaphore } from "./semaphore.js";

describe("Semaphore", () => {
  it("acquire resolves immediately when permits are available", async () => {
    const sem = new Semaphore(2);
    await expect(sem.acquire()).resolves.toBeUndefined();
    expect(sem.available).toBe(1);
  });

  it("acquire blocks when no permits are available", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let acquired = false;
    const pending = sem.acquire().then(() => {
      acquired = true;
    });

    await Promise.resolve();
    expect(acquired).toBe(false);

    sem.release();
    await pending;
    expect(acquired).toBe(true);
  });

  it("release unblocks a waiting acquire", async () => {
    const sem = new Semaphore(0);
    const order: number[] = [];

    const p = sem.acquire().then(() => {
      order.push(1);
    });

    sem.release();
    await p;

    expect(order).toEqual([1]);
  });

  it("multiple waiters are served in FIFO order", async () => {
    const sem = new Semaphore(0);
    const order: number[] = [];

    const p1 = sem.acquire().then(() => order.push(1));
    const p2 = sem.acquire().then(() => order.push(2));
    const p3 = sem.acquire().then(() => order.push(3));

    sem.release();
    await p1;
    sem.release();
    await p2;
    sem.release();
    await p3;

    expect(order).toEqual([1, 2, 3]);
  });

  it("available returns correct count", () => {
    const sem = new Semaphore(3);
    expect(sem.available).toBe(3);
  });

  it("available decreases on acquire and increases on release", async () => {
    const sem = new Semaphore(2);
    expect(sem.available).toBe(2);

    await sem.acquire();
    expect(sem.available).toBe(1);

    await sem.acquire();
    expect(sem.available).toBe(0);

    sem.release();
    expect(sem.available).toBe(1);
  });

  it("handles concurrent acquire/release stress test with permits=3", async () => {
    const sem = new Semaphore(3);
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const task = async (id: number): Promise<number> => {
      await sem.acquire();
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) {
        maxConcurrent = currentConcurrent;
      }
      await new Promise((r) => setTimeout(r, 10));
      currentConcurrent--;
      sem.release();
      return id;
    };

    const tasks = Array.from({ length: 10 }, (_, i) => task(i));
    const results = await Promise.all(tasks);

    expect(results).toHaveLength(10);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(maxConcurrent).toBeGreaterThan(0);
    expect(sem.available).toBe(3);
  });
});
