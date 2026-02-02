/**
 * NEXUS Scheduler
 *
 * Manages goals, tasks, and priority ordering.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const NEXUS_DIR = join(homedir(), '.nexus');
const GOALS_DIR = join(NEXUS_DIR, 'goals');

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
  private minCycleMs = 5000;   // Minimum 5 seconds between cycles
  private maxCycleMs = 60000;  // Maximum 60 seconds

  /**
   * Load goals from goals directory
   */
  async loadGoals(): Promise<void> {
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
          tasks.push({
            id: `${obj.id}-${tasks.length}`,
            name: taskName,
            status: 'pending',
          });
        }
      }
    }

    return {
      id,
      name: config.name,
      description: '',
      deadline: config.deadline,
      priority: config.priority || 1,
      workingDirectory: config.workingDirectory,
      tasks,
      status: 'active',
      progress: 0,
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
    }

    // Update goal progress
    const completed = goal.tasks.filter(t => t.status === 'completed').length;
    goal.progress = Math.round((completed / goal.tasks.length) * 100);
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
