import { describe, expect, it } from "vitest";
import { CyclicDependencyError, VorqError } from "../errors/index.js";
import { DAGResolver } from "./dag-resolver.js";

describe("DAGResolver", () => {
  describe("addTask", () => {
    it("registers a task with no dependencies", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);
      expect(resolver.hasDependencies("a")).toBe(false);
      expect(resolver.isReady("a")).toBe(true);
    });

    it("registers a task with dependencies — task is not ready until deps completed", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);
      resolver.addTask("b", ["a"]);
      expect(resolver.hasDependencies("b")).toBe(true);
      expect(resolver.isReady("b")).toBe(false);
    });
  });

  describe("resolve", () => {
    it("returns newly ready tasks when dependency is completed", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);
      resolver.addTask("b", ["a"]);
      resolver.addTask("c", ["a"]);

      const readyTasks = resolver.resolve("a");
      expect(readyTasks).toContain("b");
      expect(readyTasks).toContain("c");
      expect(readyTasks).toHaveLength(2);
    });

    it("returns empty array when no dependents are freed", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);
      resolver.addTask("b", ["a"]);
      resolver.addTask("c", ["a", "b"]);

      const readyTasks = resolver.resolve("a");
      expect(readyTasks).toEqual(["b"]);
    });

    it("returns empty array when task has no dependents", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);

      const readyTasks = resolver.resolve("a");
      expect(readyTasks).toEqual([]);
    });
  });

  describe("cycle detection", () => {
    it("throws CyclicDependencyError when adding a task creates a cycle", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);
      resolver.addTask("b", ["a"]);
      resolver.addTask("c", ["b"]);

      expect(() => resolver.addTask("a", ["c"])).toThrow(CyclicDependencyError);
    });

    it("includes the cycle path in the error", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);
      resolver.addTask("b", ["a"]);
      resolver.addTask("c", ["b"]);

      try {
        resolver.addTask("a", ["c"]);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CyclicDependencyError);
        expect((error as CyclicDependencyError).path).toBeDefined();
        expect((error as CyclicDependencyError).path.length).toBeGreaterThan(0);
      }
    });
  });

  describe("diamond dependency", () => {
    it("D is ready only after both B and C complete", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);
      resolver.addTask("b", ["a"]);
      resolver.addTask("c", ["a"]);
      resolver.addTask("d", ["b", "c"]);

      const afterA = resolver.resolve("a");
      expect(afterA).toContain("b");
      expect(afterA).toContain("c");
      expect(afterA).not.toContain("d");

      const afterB = resolver.resolve("b");
      expect(afterB).toEqual([]);
      expect(resolver.isReady("d")).toBe(false);

      const afterC = resolver.resolve("c");
      expect(afterC).toEqual(["d"]);
      expect(resolver.isReady("d")).toBe(true);
    });
  });

  describe("abandon", () => {
    it("returns all downstream task IDs transitively", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);
      resolver.addTask("b", ["a"]);
      resolver.addTask("c", ["b"]);
      resolver.addTask("d", ["c"]);

      const abandoned = resolver.abandon("a");
      expect(abandoned).toContain("b");
      expect(abandoned).toContain("c");
      expect(abandoned).toContain("d");
      expect(abandoned).toHaveLength(3);
    });

    it("returns empty array when task has no dependents", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);

      expect(resolver.abandon("a")).toEqual([]);
    });

    it("returns all branches in a diamond", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);
      resolver.addTask("b", ["a"]);
      resolver.addTask("c", ["a"]);
      resolver.addTask("d", ["b", "c"]);

      const abandoned = resolver.abandon("a");
      expect(abandoned).toContain("b");
      expect(abandoned).toContain("c");
      expect(abandoned).toContain("d");
      expect(abandoned).toHaveLength(3);
    });
  });

  describe("max depth", () => {
    it("throws VorqError when depth exceeds 100", () => {
      const resolver = new DAGResolver();
      resolver.addTask("task-0", []);
      for (let i = 1; i <= 100; i++) {
        resolver.addTask(`task-${i}`, [`task-${i - 1}`]);
      }

      expect(() => resolver.addTask("task-101", ["task-100"])).toThrow(VorqError);
    });

    it("allows depth of exactly 100", () => {
      const resolver = new DAGResolver();
      resolver.addTask("task-0", []);
      for (let i = 1; i <= 99; i++) {
        resolver.addTask(`task-${i}`, [`task-${i - 1}`]);
      }

      expect(() => resolver.addTask("task-100", ["task-99"])).not.toThrow();
    });
  });

  describe("isReady", () => {
    it("returns true for task with no dependencies", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);
      expect(resolver.isReady("a")).toBe(true);
    });

    it("returns false when dependencies are not completed", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);
      resolver.addTask("b", ["a"]);
      expect(resolver.isReady("b")).toBe(false);
    });

    it("returns true after all dependencies are completed", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);
      resolver.addTask("b", ["a"]);
      resolver.resolve("a");
      expect(resolver.isReady("b")).toBe(true);
    });
  });

  describe("hasDependencies", () => {
    it("returns false for task with no dependencies", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);
      expect(resolver.hasDependencies("a")).toBe(false);
    });

    it("returns true for task with dependencies", () => {
      const resolver = new DAGResolver();
      resolver.addTask("a", []);
      resolver.addTask("b", ["a"]);
      expect(resolver.hasDependencies("b")).toBe(true);
    });

    it("returns false for unknown task", () => {
      const resolver = new DAGResolver();
      expect(resolver.hasDependencies("unknown")).toBe(false);
    });
  });
});
