/**
 * NEXUS Core Loop
 *
 * The 24/7 autonomous agent loop that:
 * 1. PERCEIVE - Gather state + memory context
 * 2. THINK - Decide next action using Claude
 * 3. ACT - Execute via Claude Agent SDK
 * 4. LEARN - Record to HutchMem (via hooks)
 * 5. ADAPT - Adjust strategy if needed
 * 6. REPEAT - Forever
 */

import { existsSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Scheduler } from '../scheduler/scheduler.js';
import { runCycle } from './cycle.js';

const NEXUS_DIR = join(homedir(), '.nexus');
const STATE_FILE = join(NEXUS_DIR, 'state.json');
const LOG_FILE = process.env.NEXUS_LOG_FILE || join(NEXUS_DIR, 'nexus.log');

interface AgentState {
  currentGoal?: string;
  currentTask?: string;
  cycleCount: number;
  startedAt: string;
  lastCycleAt?: string;
  progress: Record<string, number>;
  recentActions: Array<{
    action: string;
    outcome: 'success' | 'failure';
    timestamp: string;
  }>;
}

// Global state
let state: AgentState;
let scheduler: Scheduler;
let running = true;

/**
 * Log message to file and optionally console
 */
function log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}\n`;

  appendFileSync(LOG_FILE, line);

  if (process.env.NODE_ENV !== 'production') {
    const colors: Record<string, string> = {
      INFO: '\x1b[36m',
      WARN: '\x1b[33m',
      ERROR: '\x1b[31m',
      DEBUG: '\x1b[90m',
    };
    console.log(`${colors[level]}[${level}]\x1b[0m ${message}`);
  }
}

/**
 * Save state to file
 */
function saveState() {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Handle shutdown gracefully
 */
function handleShutdown(signal: string) {
  log('INFO', `Received ${signal}, shutting down gracefully...`);
  running = false;

  // Save final state
  saveState();

  log('INFO', 'NEXUS agent stopped');
  process.exit(0);
}

/**
 * Main loop - runs forever
 */
export async function runLoop() {
  // Ensure directory exists
  mkdirSync(NEXUS_DIR, { recursive: true });

  // Initialize state
  state = {
    cycleCount: 0,
    startedAt: new Date().toISOString(),
    progress: {},
    recentActions: [],
  };

  // Initialize scheduler
  scheduler = new Scheduler();
  await scheduler.loadGoals();

  // Setup signal handlers
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));

  log('INFO', '='.repeat(50));
  log('INFO', 'NEXUS Agent Starting');
  log('INFO', '='.repeat(50));
  log('INFO', `Goals loaded: ${scheduler.getGoalNames().join(', ')}`);

  // The infinite loop
  while (running) {
    try {
      state.cycleCount++;
      log('INFO', `--- Cycle ${state.cycleCount} ---`);

      // Get current goal and task
      const goal = scheduler.getCurrentGoal();
      const task = scheduler.getCurrentTask();

      if (!goal) {
        log('INFO', 'No active goals. Waiting for new goals...');
        await scheduler.waitForNextCycle(60000); // Wait 1 minute
        continue;
      }

      state.currentGoal = goal.name;
      state.currentTask = task?.name || 'Planning next task';
      saveState();

      log('INFO', `Goal: ${goal.name}`);
      log('INFO', `Task: ${state.currentTask}`);

      // Run one cycle of the agent
      const result = await runCycle({
        goal,
        task,
        state,
        scheduler,
      });

      // Record the action
      state.recentActions.push({
        action: result.action,
        outcome: result.success ? 'success' : 'failure',
        timestamp: new Date().toISOString(),
      });

      // Keep only last 20 actions
      if (state.recentActions.length > 20) {
        state.recentActions = state.recentActions.slice(-20);
      }

      // Update progress
      state.progress = scheduler.getProgress();
      state.lastCycleAt = new Date().toISOString();
      saveState();

      if (result.success) {
        log('INFO', `Action completed: ${result.action}`);
      } else {
        log('WARN', `Action failed: ${result.action} - ${result.error}`);
      }

      // Check if goal completed
      if (scheduler.isGoalCompleted(goal.id)) {
        log('INFO', `Goal completed: ${goal.name}`);
        scheduler.markGoalCompleted(goal.id);
      }

      // Wait before next cycle (rate limiting)
      await scheduler.waitForNextCycle();

    } catch (err: any) {
      log('ERROR', `Cycle error: ${err.message}`);
      log('DEBUG', err.stack);

      // Record failure
      state.recentActions.push({
        action: 'cycle-error',
        outcome: 'failure',
        timestamp: new Date().toISOString(),
      });
      saveState();

      // Wait longer after error
      await scheduler.waitForNextCycle(30000);
    }
  }
}

// Run if executed directly
if (import.meta.main) {
  runLoop().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
