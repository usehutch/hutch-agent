/**
 * NEXUS Core Loop
 *
 * The 24/7 autonomous agent loop with:
 * - HEARTBEAT: Health monitoring, progress tracking, adaptation
 * - PLANNER: Goal analysis, memory queries, approach selection
 * - EXECUTOR: Claude-powered task execution
 * - REFLECTOR: Outcome analysis, learning, strategy adjustment
 */

import { existsSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Scheduler } from '../scheduler/scheduler.js';
import { Heartbeat, HealthMetrics } from './heartbeat.js';
import { Planner, Plan } from './planner.js';
import { Reflector, Reflection } from './reflector.js';
import { runCycle } from './cycle.js';

const NEXUS_DIR = join(homedir(), '.nexus');
const STATE_FILE = join(NEXUS_DIR, 'state.json');
const LOG_FILE = process.env.NEXUS_LOG_FILE || join(NEXUS_DIR, 'nexus.log');

interface AgentState {
  // Identity
  agentId: string;
  startedAt: string;

  // Current work
  currentGoal?: string;
  currentTask?: string;
  currentApproach?: string;

  // Metrics
  cycleCount: number;
  lastCycleAt?: string;
  progress: Record<string, number>;

  // History
  recentActions: Array<{
    action: string;
    outcome: 'success' | 'failure' | 'partial';
    approach?: string;
    durationMs?: number;
    timestamp: string;
  }>;

  // Health
  health: {
    isHealthy: boolean;
    successRate: number;
    consecutiveFailures: number;
    urgencyLevel: string;
  };
}

// Global components
let state: AgentState;
let scheduler: Scheduler;
let heartbeat: Heartbeat;
let planner: Planner;
let reflector: Reflector;
let running = true;

/**
 * Log message to file and console
 */
function log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'PLAN' | 'REFLECT', message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}\n`;

  appendFileSync(LOG_FILE, line);

  if (process.env.NODE_ENV !== 'production') {
    const colors: Record<string, string> = {
      INFO: '\x1b[36m',     // Cyan
      WARN: '\x1b[33m',     // Yellow
      ERROR: '\x1b[31m',    // Red
      DEBUG: '\x1b[90m',    // Gray
      PLAN: '\x1b[35m',     // Magenta
      REFLECT: '\x1b[32m',  // Green
    };
    console.log(`${colors[level] || ''}[${level}]\x1b[0m ${message}`);
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

  // Stop heartbeat
  heartbeat.stop();

  // Save final state
  saveState();

  log('INFO', 'NEXUS agent stopped');
  process.exit(0);
}

/**
 * Handle heartbeat alerts
 */
function handleAlert(alert: string, metrics: HealthMetrics) {
  log('WARN', `ALERT: ${alert}`);

  // Update state health
  state.health = {
    isHealthy: metrics.isHealthy,
    successRate: metrics.successRate,
    consecutiveFailures: metrics.consecutiveFailures,
    urgencyLevel: metrics.urgencyLevel,
  };
  saveState();
}

/**
 * Main loop - runs forever
 */
export async function runLoop() {
  // Ensure directory exists
  mkdirSync(NEXUS_DIR, { recursive: true });

  // Initialize state
  state = {
    agentId: `nexus-${Date.now()}`,
    cycleCount: 0,
    startedAt: new Date().toISOString(),
    progress: {},
    recentActions: [],
    health: {
      isHealthy: true,
      successRate: 100,
      consecutiveFailures: 0,
      urgencyLevel: 'low',
    },
  };

  // Initialize components
  scheduler = new Scheduler();
  await scheduler.loadGoals();

  heartbeat = new Heartbeat({
    intervalMs: 30000,  // 30 seconds
    failureThreshold: 3,
  });

  planner = new Planner();
  reflector = new Reflector();

  // Start heartbeat
  heartbeat.start(
    (metrics) => {
      state.health = {
        isHealthy: metrics.isHealthy,
        successRate: metrics.successRate,
        consecutiveFailures: metrics.consecutiveFailures,
        urgencyLevel: metrics.urgencyLevel,
      };
    },
    handleAlert
  );

  // Setup signal handlers
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));

  // Startup banner
  log('INFO', '═'.repeat(60));
  log('INFO', '  NEXUS Agent Starting');
  log('INFO', '  24/7 Autonomous AI Agent powered by HutchMem');
  log('INFO', '═'.repeat(60));
  log('INFO', `Agent ID: ${state.agentId}`);
  log('INFO', `Goals loaded: ${scheduler.getGoalNames().join(', ')}`);
  log('INFO', '');

  // The infinite loop
  while (running) {
    const cycleStart = Date.now();

    try {
      state.cycleCount++;

      // ═══════════════════════════════════════════════════════════════
      // PHASE 1: PERCEIVE - Gather current state and context
      // ═══════════════════════════════════════════════════════════════

      const goal = scheduler.getCurrentGoal();
      const task = scheduler.getCurrentTask();
      const metrics = heartbeat.getMetrics({
        tasksCompleted: goal?.tasks.filter(t => t.status === 'completed').length || 0,
        tasksTotal: goal?.tasks.length || 1,
        deadline: goal?.deadline || null,
      });

      if (!goal) {
        log('INFO', 'No active goals. Waiting...');
        await scheduler.waitForNextCycle(60000);
        continue;
      }

      log('INFO', `━━━ Cycle ${state.cycleCount} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      log('INFO', `Goal: ${goal.name}`);
      log('INFO', `Task: ${task?.name || 'Determining next action...'}`);

      state.currentGoal = goal.name;
      state.currentTask = task?.name || 'Planning';

      // ═══════════════════════════════════════════════════════════════
      // PHASE 2: PLAN - Create an action plan
      // ═══════════════════════════════════════════════════════════════

      log('PLAN', 'Creating action plan...');

      const plan = await planner.createPlan({
        goal,
        task,
        metrics,
        recentActions: state.recentActions.map(a => ({
          action: a.action,
          outcome: a.outcome === 'partial' ? 'failure' : a.outcome,
        })),
      });

      log('PLAN', `Approach: ${plan.approach}`);
      log('PLAN', `Steps: ${plan.steps.length}`);
      log('PLAN', `Complexity: ${plan.estimatedComplexity} | Risk: ${plan.riskLevel}`);

      if (plan.relevantMemory.length > 0) {
        log('PLAN', `Memory context: ${plan.relevantMemory.length} relevant observations`);
      }

      state.currentApproach = plan.approach;
      saveState();

      // ═══════════════════════════════════════════════════════════════
      // PHASE 3: ACT - Execute the plan
      // ═══════════════════════════════════════════════════════════════

      log('INFO', 'Executing...');

      const result = await runCycle({
        goal,
        task: plan.task,
        state: {
          cycleCount: state.cycleCount,
          recentActions: state.recentActions.map(a => ({
            action: a.action,
            outcome: a.outcome === 'partial' ? 'failure' : a.outcome,
          })),
        },
        scheduler,
        customPrompt: plan.prompt,  // Use planner's enhanced prompt
      });

      const cycleDuration = Date.now() - cycleStart;

      // ═══════════════════════════════════════════════════════════════
      // PHASE 4: REFLECT - Analyze outcome and learn
      // ═══════════════════════════════════════════════════════════════

      log('REFLECT', 'Analyzing outcome...');

      const reflection = reflector.reflect(plan, {
        success: result.success,
        output: result.output || '',
        error: result.error,
        durationMs: cycleDuration,
      }, metrics);

      // Record outcome to heartbeat
      heartbeat.recordCycle(reflection.outcome === 'success');

      // Log reflection
      const outcomeIcon = reflection.outcome === 'success' ? '✓' : reflection.outcome === 'partial' ? '~' : '✗';
      log('REFLECT', `${outcomeIcon} ${reflection.summary}`);

      if (reflection.keyInsight) {
        log('REFLECT', `Insight: ${reflection.keyInsight}`);
      }

      if (reflection.suggestedChange) {
        log('REFLECT', `Suggestion: ${reflection.suggestedChange}`);
      }

      // ═══════════════════════════════════════════════════════════════
      // PHASE 5: ADAPT - Update state and strategy
      // ═══════════════════════════════════════════════════════════════

      // Record action
      state.recentActions.push({
        action: result.action,
        outcome: reflection.outcome,
        approach: plan.approach.split(':')[0],
        durationMs: cycleDuration,
        timestamp: new Date().toISOString(),
      });

      // Keep only last 50 actions
      if (state.recentActions.length > 50) {
        state.recentActions = state.recentActions.slice(-50);
      }

      // Update progress
      state.progress = scheduler.getProgress();
      state.lastCycleAt = new Date().toISOString();

      // Check if goal completed
      if (scheduler.isGoalCompleted(goal.id)) {
        log('INFO', `🎉 Goal completed: ${goal.name}`);
        scheduler.markGoalCompleted(goal.id);
      }

      saveState();

      // ═══════════════════════════════════════════════════════════════
      // WAIT - Rate limiting with adaptive pacing
      // ═══════════════════════════════════════════════════════════════

      const delay = heartbeat.getRecommendedDelay();
      log('DEBUG', `Next cycle in ${delay / 1000}s`);

      await new Promise(resolve => setTimeout(resolve, delay));

    } catch (err: any) {
      log('ERROR', `Cycle error: ${err.message}`);
      log('DEBUG', err.stack);

      // Record failure
      heartbeat.recordCycle(false);

      state.recentActions.push({
        action: 'cycle-error',
        outcome: 'failure',
        timestamp: new Date().toISOString(),
      });
      saveState();

      // Wait longer after error
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
}

// Run if executed directly (works in both Node and Bun)
const isMain = import.meta.url === `file://${process.argv[1]}` ||
               (import.meta as any).main === true;

if (isMain) {
  runLoop().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
