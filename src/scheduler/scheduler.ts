/**
 * NEXUS Scheduler
 *
 * Manages goals, tasks, and priority ordering.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const NEXUS_DIR = join(homedir(), '.nexus');
const GOALS_DIR = join(NEXUS_DIR, 'goals');
const COMPLETED_TASKS_FILE = join(NEXUS_DIR, 'completed-tasks.json');

export interface Task {
  id: string;
  name: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  completedAt?: string;
}

export interface Goal {
  id: string;
  name: string;
  description?: string;
  deadline?: string;
  priority: number;
  workingDirectory?: string;
  tasks: Task[];
  status: 'active' | 'completed' | 'paused';
  progress: number;
}

interface GoalConfig {
  name: string;
  deadline?: string;
  priority?: number;
  workingDirectory?: string;
  objectives?: Array<{
    id: string;
    name: string;
    tasks: string[];
  }>;
  constraints?: Record<string, boolean>;
}

export class Scheduler {
  private goals: Goal[] = [];
  private completedTaskIds: Set<string> = new Set();
  private minCycleMs = 5000;   // Minimum 5 seconds between cycles
  private maxCycleMs = 60000;  // Maximum 60 seconds

  /**
   * Load completed tasks from persistent storage
   */
  private loadCompletedTasks(): void {
    try {
      if (existsSync(COMPLETED_TASKS_FILE)) {
        const data = JSON.parse(readFileSync(COMPLETED_TASKS_FILE, 'utf-8')) as { taskIds: string[] };
        this.completedTaskIds = new Set(data.taskIds || []);
        console.log(`[Scheduler] Loaded ${this.completedTaskIds.size} completed tasks from storage`);
        if (this.completedTaskIds.size > 0) {
          console.log(`[Scheduler] Pre-completed: ${Array.from(this.completedTaskIds).join(', ')}`);
        }
      } else {
        console.log(`[Scheduler] No completed tasks file found at ${COMPLETED_TASKS_FILE}`);
      }
    } catch (err) {
      console.error('[Scheduler] Failed to load completed tasks:', err);
    }
  }

  /**
   * Save completed tasks to persistent storage
   */
  private saveCompletedTasks(): void {
    try {
      mkdirSync(NEXUS_DIR, { recursive: true });
      const data = { taskIds: Array.from(this.completedTaskIds) };
      writeFileSync(COMPLETED_TASKS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[Scheduler] Failed to save completed tasks:', err);
    }
  }

  /**
   * Load goals from goals directory
   */
  async loadGoals(): Promise<void> {
    // Load previously completed tasks first
    this.loadCompletedTasks();
    this.goals = [];

    // Check for default goals file
    const defaultGoals = join(process.cwd(), 'goals');
    const localGoals = existsSync(defaultGoals) ? defaultGoals : GOALS_DIR;

    // Load all .json files from goals directory
    const goalsPath = localGoals;
    if (!existsSync(goalsPath)) {
      return;
    }

    const { readdirSync } = await import('fs');
    const files = readdirSync(goalsPath).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const content = readFileSync(join(goalsPath, file), 'utf-8');
        const config: GoalConfig = JSON.parse(content);
        const goal = this.parseGoalConfig(file.replace('.json', ''), config);
        this.goals.push(goal);
      } catch (err) {
        console.error(`Failed to load goal from ${file}:`, err);
      }
    }

    // Sort by priority
    this.goals.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Parse a goal config file into a Goal object
   */
  private parseGoalConfig(id: string, config: GoalConfig): Goal {
    const tasks: Task[] = [];

    // Convert objectives to tasks
    if (config.objectives) {
      for (const obj of config.objectives) {
        for (const taskName of obj.tasks) {
          const taskId = `${obj.id}-${tasks.length}`;
          const isCompleted = this.completedTaskIds.has(taskId);
          tasks.push({
            id: taskId,
            name: taskName,
            status: isCompleted ? 'completed' : 'pending',
            completedAt: isCompleted ? new Date().toISOString() : undefined,
          });
        }
      }
    }

    // Calculate initial progress
    const completed = tasks.filter(t => t.status === 'completed').length;
    const progress = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;

    return {
      id,
      name: config.name,
      description: '',
      deadline: config.deadline,
      priority: config.priority || 1,
      workingDirectory: config.workingDirectory,
      tasks,
      status: 'active',
      progress,
    };
  }

  /**
   * Get names of all goals
   */
  getGoalNames(): string[] {
    return this.goals.map(g => g.name);
  }

  /**
   * Get the current goal to work on
   */
  getCurrentGoal(): Goal | null {
    // Find first active goal
    return this.goals.find(g => g.status === 'active') || null;
  }

  /**
   * Get the current task within a goal
   */
  getCurrentTask(): Task | null {
    const goal = this.getCurrentGoal();
    if (!goal) return null;

    // Find first pending or in_progress task
    return goal.tasks.find(t =>
      t.status === 'pending' || t.status === 'in_progress'
    ) || null;
  }

  /**
   * Mark a task as completed
   */
  markTaskCompleted(goalId: string, taskId: string): void {
    const goal = this.goals.find(g => g.id === goalId);
    if (!goal) return;

    const task = goal.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'completed';
      task.completedAt = new Date().toISOString();

      // Persist to storage
      this.completedTaskIds.add(taskId);
      this.saveCompletedTasks();
    }

    // Update goal progress
    const completed = goal.tasks.filter(t => t.status === 'completed').length;
    goal.progress = Math.round((completed / goal.tasks.length) * 100);
  }

  /**
   * Manually mark tasks as completed (for bootstrap)
   */
  markTasksCompletedByPattern(pattern: RegExp): number {
    let count = 0;
    for (const goal of this.goals) {
      for (const task of goal.tasks) {
        if (pattern.test(task.name) && task.status !== 'completed') {
          task.status = 'completed';
          task.completedAt = new Date().toISOString();
          this.completedTaskIds.add(task.id);
          count++;
        }
      }
      // Update progress
      const completed = goal.tasks.filter(t => t.status === 'completed').length;
      goal.progress = Math.round((completed / goal.tasks.length) * 100);
    }
    if (count > 0) {
      this.saveCompletedTasks();
    }
    return count;
  }

  /**
   * Check if a goal is completed
   */
  isGoalCompleted(goalId: string): boolean {
    const goal = this.goals.find(g => g.id === goalId);
    if (!goal) return false;

    return goal.tasks.every(t => t.status === 'completed');
  }

  /**
   * Mark a goal as completed
   */
  markGoalCompleted(goalId: string): void {
    const goal = this.goals.find(g => g.id === goalId);
    if (goal) {
      goal.status = 'completed';
      goal.progress = 100;
    }
  }

  /**
   * Get progress for all goals
   */
  getProgress(): Record<string, number> {
    const progress: Record<string, number> = {};
    for (const goal of this.goals) {
      progress[goal.name] = goal.progress;
    }
    return progress;
  }

  /**
   * Wait for next cycle with rate limiting
   */
  async waitForNextCycle(minMs?: number): Promise<void> {
    const waitMs = Math.max(minMs || this.minCycleMs, this.minCycleMs);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}
