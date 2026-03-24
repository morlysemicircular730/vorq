import { CyclicDependencyError } from "../errors/cyclic-dependency-error.js";
import { VorqError } from "../errors/vorq-error.js";

class MaxDepthExceededError extends VorqError {
  readonly code = "MAX_DEPTH_EXCEEDED";
}

const MAX_DEPTH = 100;

export class DAGResolver {
  private readonly dependencies = new Map<string, Set<string>>();
  private readonly dependents = new Map<string, Set<string>>();
  private readonly completed = new Set<string>();

  addTask(taskId: string, dependsOn: string[]): void {
    this.dependencies.set(taskId, new Set(dependsOn));

    for (const dep of dependsOn) {
      if (!this.dependents.has(dep)) {
        this.dependents.set(dep, new Set());
      }
      this.dependents.get(dep)?.add(taskId);
    }

    this.detectCycle(taskId);
    this.checkDepth(taskId);
  }

  resolve(completedTaskId: string): string[] {
    this.completed.add(completedTaskId);

    const deps = this.dependents.get(completedTaskId);
    if (!deps) {
      return [];
    }

    const newlyReady: string[] = [];
    for (const dependent of deps) {
      if (this.isReady(dependent)) {
        newlyReady.push(dependent);
      }
    }
    return newlyReady;
  }

  abandon(failedTaskId: string): string[] {
    const downstream: string[] = [];
    const queue = [failedTaskId];
    const visited = new Set<string>();
    visited.add(failedTaskId);

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) {
        break;
      }
      const deps = this.dependents.get(current);
      if (!deps) {
        continue;
      }
      for (const dep of deps) {
        if (!visited.has(dep)) {
          visited.add(dep);
          downstream.push(dep);
          queue.push(dep);
        }
      }
    }

    return downstream;
  }

  isReady(taskId: string): boolean {
    const deps = this.dependencies.get(taskId);
    if (!deps || deps.size === 0) {
      return true;
    }
    for (const dep of deps) {
      if (!this.completed.has(dep)) {
        return false;
      }
    }
    return true;
  }

  hasDependencies(taskId: string): boolean {
    const deps = this.dependencies.get(taskId);
    return deps !== undefined && deps.size > 0;
  }

  private detectCycle(taskId: string): void {
    const visited = new Set<string>();
    const path: string[] = [];

    const dfs = (current: string): void => {
      if (path.includes(current)) {
        const cycleStart = path.indexOf(current);
        const cyclePath = [...path.slice(cycleStart), current];
        this.rollbackTask(taskId);
        throw new CyclicDependencyError(`Cycle detected: ${cyclePath.join(" -> ")}`, cyclePath);
      }
      if (visited.has(current)) {
        return;
      }
      visited.add(current);
      path.push(current);

      const deps = this.dependencies.get(current);
      if (deps) {
        for (const dep of deps) {
          dfs(dep);
        }
      }

      path.pop();
    };

    dfs(taskId);
  }

  private checkDepth(taskId: string): void {
    const depth = this.calculateDepth(taskId, new Set());
    if (depth > MAX_DEPTH) {
      this.rollbackTask(taskId);
      throw new MaxDepthExceededError(
        `Task dependency depth ${depth} exceeds maximum of ${MAX_DEPTH}`,
      );
    }
  }

  private calculateDepth(taskId: string, visited: Set<string>): number {
    if (visited.has(taskId)) {
      return 0;
    }
    visited.add(taskId);

    const deps = this.dependencies.get(taskId);
    if (!deps || deps.size === 0) {
      return 0;
    }

    let maxDepth = 0;
    for (const dep of deps) {
      const d = this.calculateDepth(dep, visited);
      if (d > maxDepth) {
        maxDepth = d;
      }
    }
    return maxDepth + 1;
  }

  private rollbackTask(taskId: string): void {
    const deps = this.dependencies.get(taskId);
    if (deps) {
      for (const dep of deps) {
        this.dependents.get(dep)?.delete(taskId);
      }
    }
    this.dependencies.delete(taskId);
  }
}
