/**
 * Hutch Agent DAG Scheduler
 *
 * Task scheduling with dependency tracking:
 * - Tasks can depend on other tasks
 * - Parallel execution of independent tasks
 * - Topological sorting for execution order
 * - Cycle detection to prevent deadlocks
 * - Status propagation (blocked tasks block dependents)
 *
 * Extends the basic Scheduler with DAG capabilities.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const AGENT_DIR = join(homedir(), '.hutch-agent');
const DAG_STATE_FILE = join(AGENT_DIR, 'dag-state.json');

/**
 * Task status with additional DAG-specific states
 */
export type DAGTaskStatus =
  | 'pending'        // Not yet ready (dependencies not met)
  | 'ready'          // All dependencies met, can execute
  | 'running'        // Currently being executed
  | 'completed'      // Successfully completed
  | 'failed'         // Execution failed
  | 'blocked'        // Blocked by failed/blocked dependency
  | 'skipped';       // Explicitly skipped

/**
 * DAG Task definition
 */
export interface DAGTask {
  id: string;
  name: string;
  description?: string;
  /** IDs of tasks that must complete before this one */
  dependencies: string[];
  status: DAGTaskStatus;
  /** Maximum retry attempts */
  maxRetries: number;
  /** Current retry count */
  currentRetries: number;
  /** Priority (lower = higher priority among ready tasks) */
  priority: number;
  /** Estimated duration in ms (for scheduling hints) */
  estimatedDurationMs?: number;
  /** Actual duration in ms */
  actualDurationMs?: number;
  /** Result/output from execution */
  result?: string;
  /** Error message if failed */
  error?: string;
  /** Timestamp of status changes */
  startedAt?: string;
  completedAt?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * DAG Goal definition
 */
export interface DAGGoal {
  id: string;
  name: string;
  description?: string;
  tasks: DAGTask[];
  /** Goal-level deadline */
  deadline?: string;
  /** Working directory for execution */
  workingDirectory?: string;
  status: 'active' | 'completed' | 'paused' | 'failed';
  progress: number;
  createdAt: string;
  completedAt?: string;
}

/**
 * Task execution result
 */
export interface TaskExecutionResult {
  taskId: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

/**
 * DAG analysis result
 */
export interface DAGAnalysis {
  totalTasks: number;
  completedTasks: number;
  readyTasks: number;
  runningTasks: number;
  blockedTasks: number;
  failedTasks: number;
  criticalPath: string[];
  estimatedRemainingMs: number;
  hasCycle: boolean;
  cycleNodes?: string[];
}

/**
 * DAG Scheduler
 *
 * Usage:
 * ```
 * const scheduler = new DAGScheduler();
 * await scheduler.loadGoal('my-goal.json');
 *
 * // Get ready tasks (can run in parallel)
 * const ready = scheduler.getReadyTasks();
 *
 * // Execute a task
 * const task = ready[0];
 * scheduler.markTaskRunning(task.id);
 *
 * // ... execute task ...
 *
 * // Record result
 * scheduler.recordTaskResult({
 *   taskId: task.id,
 *   success: true,
 *   output: 'Created file',
 *   durationMs: 5000
 * });
 *
 * // Get next ready tasks
 * const nextReady = scheduler.getReadyTasks();
 * ```
 */
export class DAGScheduler {
  private goals: Map<string, DAGGoal> = new Map();
  private currentGoalId: string | null = null;

  constructor() {
    // Ensure directory exists
    mkdirSync(AGENT_DIR, { recursive: true });
  }

  /**
   * Load a goal with DAG tasks from a JSON file
   */
  async loadGoal(filepath: string): Promise<DAGGoal | null> {
    if (!existsSync(filepath)) {
      console.log(`[DAGScheduler] Goal file not found: ${filepath}`);
      return null;
    }

    try {
      const content = readFileSync(filepath, 'utf-8');
      const config = JSON.parse(content);
      const goal = this.parseGoalConfig(config);

      // Validate DAG (check for cycles)
      const analysis = this.analyzeDAG(goal);
      if (analysis.hasCycle) {
        console.error(`[DAGScheduler] Goal has dependency cycle: ${analysis.cycleNodes?.join(' -> ')}`);
        return null;
      }

      this.goals.set(goal.id, goal);
      this.currentGoalId = goal.id;

      console.log(`[DAGScheduler] Loaded goal: ${goal.name} (${goal.tasks.length} tasks)`);
      return goal;
    } catch (err) {
      console.error(`[DAGScheduler] Failed to load goal: ${err}`);
      return null;
    }
  }

  /**
   * Parse goal configuration
   */
  private parseGoalConfig(config: any): DAGGoal {
    const tasks: DAGTask[] = [];

    // Parse tasks with dependencies
    if (config.tasks) {
      for (const taskConfig of config.tasks) {
        tasks.push({
          id: taskConfig.id,
          name: taskConfig.name,
          description: taskConfig.description,
          dependencies: taskConfig.dependencies || [],
          status: 'pending',
          maxRetries: taskConfig.maxRetries ?? 3,
          currentRetries: 0,
          priority: taskConfig.priority ?? 5,
          estimatedDurationMs: taskConfig.estimatedDurationMs,
          metadata: taskConfig.metadata,
        });
      }
    }

    // Legacy format: objectives with task lists
    if (config.objectives) {
      let taskIndex = 0;
      let previousTaskId: string | null = null;

      for (const obj of config.objectives) {
        for (const taskName of obj.tasks || []) {
          const taskId = `${obj.id}-${taskIndex}`;
          tasks.push({
            id: taskId,
            name: typeof taskName === 'string' ? taskName : taskName.name,
            description: typeof taskName === 'object' ? taskName.description : undefined,
            // Legacy: sequential dependencies within objective
            dependencies: previousTaskId ? [previousTaskId] : [],
            status: 'pending',
            maxRetries: 3,
            currentRetries: 0,
            priority: taskIndex,
          });
          previousTaskId = taskId;
          taskIndex++;
        }
        // Reset for next objective (objectives are independent)
        previousTaskId = null;
      }
    }

    // Update initial status based on dependencies
    this.updateTaskStatuses(tasks);

    const goal: DAGGoal = {
      id: config.id || `goal-${Date.now()}`,
      name: config.name,
      description: config.description,
      tasks,
      deadline: config.deadline,
      workingDirectory: config.workingDirectory,
      status: 'active',
      progress: 0,
      createdAt: new Date().toISOString(),
    };

    return goal;
  }

  /**
   * Update task statuses based on dependencies
   */
  private updateTaskStatuses(tasks: DAGTask[]): void {
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    for (const task of tasks) {
      if (task.status === 'completed' || task.status === 'running') {
        continue;
      }

      // Check dependencies
      let allDepsComplete = true;
      let anyDepBlockedOrFailed = false;

      for (const depId of task.dependencies) {
        const dep = taskMap.get(depId);
        if (!dep) continue;

        if (dep.status !== 'completed') {
          allDepsComplete = false;
        }
        if (dep.status === 'blocked' || dep.status === 'failed') {
          anyDepBlockedOrFailed = true;
        }
      }

      if (anyDepBlockedOrFailed) {
        task.status = 'blocked';
      } else if (allDepsComplete) {
        task.status = 'ready';
      } else {
        task.status = 'pending';
      }
    }
  }

  /**
   * Get current goal
   */
  getCurrentGoal(): DAGGoal | null {
    if (!this.currentGoalId) return null;
    return this.goals.get(this.currentGoalId) || null;
  }

  /**
   * Get all ready tasks (can be executed in parallel)
   */
  getReadyTasks(): DAGTask[] {
    const goal = this.getCurrentGoal();
    if (!goal) return [];

    return goal.tasks
      .filter(t => t.status === 'ready')
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get the next single task to execute (highest priority ready task)
   */
  getNextTask(): DAGTask | null {
    const ready = this.getReadyTasks();
    return ready.length > 0 ? ready[0] : null;
  }

  /**
   * Mark a task as running
   */
  markTaskRunning(taskId: string): boolean {
    const goal = this.getCurrentGoal();
    if (!goal) return false;

    const task = goal.tasks.find(t => t.id === taskId);
    if (!task || task.status !== 'ready') return false;

    task.status = 'running';
    task.startedAt = new Date().toISOString();

    this.saveState();
    return true;
  }

  /**
   * Record task execution result
   */
  recordTaskResult(result: TaskExecutionResult): void {
    const goal = this.getCurrentGoal();
    if (!goal) return;

    const task = goal.tasks.find(t => t.id === result.taskId);
    if (!task) return;

    task.actualDurationMs = result.durationMs;
    task.completedAt = new Date().toISOString();

    if (result.success) {
      task.status = 'completed';
      task.result = result.output;
      console.log(`[DAGScheduler] Task completed: ${task.name}`);
    } else {
      task.currentRetries++;
      task.error = result.error;

      if (task.currentRetries >= task.maxRetries) {
        task.status = 'failed';
        console.log(`[DAGScheduler] Task failed (max retries): ${task.name}`);
      } else {
        task.status = 'ready'; // Retry
        console.log(`[DAGScheduler] Task failed, will retry (${task.currentRetries}/${task.maxRetries}): ${task.name}`);
      }
    }

    // Update dependent tasks
    this.updateTaskStatuses(goal.tasks);

    // Update goal progress
    const completed = goal.tasks.filter(t => t.status === 'completed').length;
    goal.progress = Math.round((completed / goal.tasks.length) * 100);

    // Check if goal is complete
    if (completed === goal.tasks.length) {
      goal.status = 'completed';
      goal.completedAt = new Date().toISOString();
      console.log(`[DAGScheduler] Goal completed: ${goal.name}`);
    }

    // Check if goal has failed (all paths blocked)
    const readyOrPending = goal.tasks.filter(t =>
      t.status === 'ready' || t.status === 'pending' || t.status === 'running'
    ).length;
    if (readyOrPending === 0 && goal.status !== 'completed') {
      goal.status = 'failed';
      console.log(`[DAGScheduler] Goal failed (all paths blocked): ${goal.name}`);
    }

    this.saveState();
  }

  /**
   * Skip a task and propagate to dependents
   */
  skipTask(taskId: string, reason?: string): boolean {
    const goal = this.getCurrentGoal();
    if (!goal) return false;

    const task = goal.tasks.find(t => t.id === taskId);
    if (!task) return false;

    task.status = 'skipped';
    task.result = reason || 'Skipped by user';
    task.completedAt = new Date().toISOString();

    // Update dependent tasks
    this.updateTaskStatuses(goal.tasks);
    this.saveState();

    console.log(`[DAGScheduler] Task skipped: ${task.name}`);
    return true;
  }

  /**
   * Unblock a task (retry after fixing blocker)
   */
  unblockTask(taskId: string): boolean {
    const goal = this.getCurrentGoal();
    if (!goal) return false;

    const task = goal.tasks.find(t => t.id === taskId);
    if (!task || (task.status !== 'blocked' && task.status !== 'failed')) {
      return false;
    }

    task.status = 'pending';
    task.currentRetries = 0;
    task.error = undefined;

    // Re-evaluate statuses
    this.updateTaskStatuses(goal.tasks);
    this.saveState();

    console.log(`[DAGScheduler] Task unblocked: ${task.name}`);
    return true;
  }

  /**
   * Analyze the DAG structure
   */
  analyzeDAG(goal?: DAGGoal): DAGAnalysis {
    const g = goal || this.getCurrentGoal();

    if (!g) {
      return {
        totalTasks: 0,
        completedTasks: 0,
        readyTasks: 0,
        runningTasks: 0,
        blockedTasks: 0,
        failedTasks: 0,
        criticalPath: [],
        estimatedRemainingMs: 0,
        hasCycle: false,
      };
    }

    // Count by status
    const counts = {
      completed: 0,
      ready: 0,
      running: 0,
      blocked: 0,
      failed: 0,
      pending: 0,
      skipped: 0,
    };

    for (const task of g.tasks) {
      counts[task.status]++;
    }

    // Detect cycles using DFS
    const hasCycle = this.detectCycle(g.tasks);

    // Calculate critical path (longest path through uncompleted tasks)
    const criticalPath = this.calculateCriticalPath(g.tasks);

    // Estimate remaining time
    const estimatedRemainingMs = g.tasks
      .filter(t => t.status !== 'completed' && t.status !== 'skipped')
      .reduce((sum, t) => sum + (t.estimatedDurationMs || 60000), 0);

    return {
      totalTasks: g.tasks.length,
      completedTasks: counts.completed,
      readyTasks: counts.ready,
      runningTasks: counts.running,
      blockedTasks: counts.blocked,
      failedTasks: counts.failed,
      criticalPath,
      estimatedRemainingMs,
      hasCycle,
    };
  }

  /**
   * Detect cycles in task dependencies using DFS
   */
  private detectCycle(tasks: DAGTask[]): boolean {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (taskId: string): boolean => {
      visited.add(taskId);
      recursionStack.add(taskId);

      const task = taskMap.get(taskId);
      if (!task) return false;

      for (const depId of task.dependencies) {
        if (!visited.has(depId)) {
          if (dfs(depId)) return true;
        } else if (recursionStack.has(depId)) {
          return true; // Cycle detected
        }
      }

      recursionStack.delete(taskId);
      return false;
    };

    for (const task of tasks) {
      if (!visited.has(task.id)) {
        if (dfs(task.id)) return true;
      }
    }

    return false;
  }

  /**
   * Calculate critical path (longest path of incomplete tasks)
   */
  private calculateCriticalPath(tasks: DAGTask[]): string[] {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const incomplete = tasks.filter(t =>
      t.status !== 'completed' && t.status !== 'skipped'
    );

    if (incomplete.length === 0) return [];

    // Build reverse graph (task -> tasks that depend on it)
    const dependents = new Map<string, string[]>();
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        if (!dependents.has(depId)) {
          dependents.set(depId, []);
        }
        dependents.get(depId)!.push(task.id);
      }
    }

    // Find longest path using dynamic programming
    const distances = new Map<string, number>();
    const parents = new Map<string, string>();

    // Topological sort (Kahn's algorithm)
    const inDegree = new Map<string, number>();
    for (const task of incomplete) {
      inDegree.set(task.id, task.dependencies.filter(d =>
        taskMap.get(d)?.status !== 'completed'
      ).length);
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
        distances.set(id, taskMap.get(id)?.estimatedDurationMs || 60000);
      }
    }

    while (queue.length > 0) {
      const taskId = queue.shift()!;
      const taskDist = distances.get(taskId) || 0;

      for (const depId of dependents.get(taskId) || []) {
        const dep = taskMap.get(depId);
        if (!dep || dep.status === 'completed') continue;

        const newDist = taskDist + (dep.estimatedDurationMs || 60000);
        if (newDist > (distances.get(depId) || 0)) {
          distances.set(depId, newDist);
          parents.set(depId, taskId);
        }

        const degree = (inDegree.get(depId) || 1) - 1;
        inDegree.set(depId, degree);
        if (degree === 0) {
          queue.push(depId);
        }
      }
    }

    // Find task with longest distance (end of critical path)
    let maxDist = 0;
    let endTask = '';
    for (const [id, dist] of distances) {
      if (dist > maxDist) {
        maxDist = dist;
        endTask = id;
      }
    }

    // Reconstruct path
    const path: string[] = [];
    let current = endTask;
    while (current) {
      path.unshift(current);
      current = parents.get(current) || '';
    }

    return path;
  }

  /**
   * Save current state to disk
   */
  private saveState(): void {
    try {
      const state = {
        goals: Array.from(this.goals.entries()),
        currentGoalId: this.currentGoalId,
        savedAt: new Date().toISOString(),
      };
      writeFileSync(DAG_STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error(`[DAGScheduler] Failed to save state: ${err}`);
    }
  }

  /**
   * Load state from disk
   */
  async loadState(): Promise<boolean> {
    if (!existsSync(DAG_STATE_FILE)) {
      return false;
    }

    try {
      const content = readFileSync(DAG_STATE_FILE, 'utf-8');
      const state = JSON.parse(content);

      this.goals = new Map(state.goals);
      this.currentGoalId = state.currentGoalId;

      console.log(`[DAGScheduler] Loaded state from ${state.savedAt}`);
      return true;
    } catch (err) {
      console.error(`[DAGScheduler] Failed to load state: ${err}`);
      return false;
    }
  }

  /**
   * Get progress summary
   */
  getProgressSummary(): string {
    const goal = this.getCurrentGoal();
    if (!goal) return 'No active goal';

    const analysis = this.analyzeDAG(goal);

    return `${goal.name}: ${goal.progress}% complete
  - ${analysis.completedTasks}/${analysis.totalTasks} tasks done
  - ${analysis.readyTasks} ready, ${analysis.runningTasks} running
  - ${analysis.blockedTasks} blocked, ${analysis.failedTasks} failed
  - Critical path: ${analysis.criticalPath.length} tasks remaining`;
  }
}

/**
 * Create a DAG scheduler instance
 */
export function createDAGScheduler(): DAGScheduler {
  return new DAGScheduler();
}
