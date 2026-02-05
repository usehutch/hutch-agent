/**
 * Hutch Agent State Machine
 *
 * Manages agent state transitions with:
 * - Defined states and valid transitions
 * - State persistence and checkpointing
 * - Recovery from crashes
 * - State history for debugging
 *
 * Based on LangGraph-style state machine patterns.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const AGENT_DIR = join(homedir(), '.hutch-agent');
const CHECKPOINT_DIR = join(AGENT_DIR, 'checkpoints');

/**
 * Agent lifecycle states
 */
export type AgentState =
  | 'idle'           // No task, waiting for work
  | 'planning'       // Analyzing task, creating plan
  | 'executing'      // Running task via Claude
  | 'verifying'      // Checking results
  | 'reflecting'     // Learning from outcome
  | 'blocked'        // Task blocked, needs intervention
  | 'sleeping'       // Scheduled downtime
  | 'error'          // Error state, needs recovery
  | 'shutdown';      // Graceful shutdown

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  idle: ['planning', 'sleeping', 'shutdown'],
  planning: ['executing', 'blocked', 'error', 'idle'],
  executing: ['verifying', 'blocked', 'error'],
  verifying: ['reflecting', 'executing', 'error'],  // Can retry execution
  reflecting: ['idle', 'planning', 'error'],        // Back to idle or immediate replanning
  blocked: ['planning', 'idle', 'shutdown'],        // Can retry or wait
  sleeping: ['idle', 'shutdown'],
  error: ['idle', 'planning', 'shutdown'],          // Recovery paths
  shutdown: [],                                      // Terminal state
};

/**
 * State context - data carried with state
 */
export interface StateContext {
  /** Current goal being worked on */
  goalId?: string;
  goalName?: string;

  /** Current task being executed */
  taskId?: string;
  taskName?: string;

  /** Current plan (if planning/executing) */
  planId?: string;
  planSteps?: number;
  currentStep?: number;

  /** Execution context */
  cycleCount?: number;
  consecutiveFailures?: number;
  lastError?: string;

  /** Timing */
  stateEnteredAt?: string;
  stateDurationMs?: number;

  /** Custom data */
  metadata?: Record<string, unknown>;
}

/**
 * State transition record
 */
export interface StateTransition {
  from: AgentState;
  to: AgentState;
  context: StateContext;
  timestamp: string;
  reason?: string;
}

/**
 * Checkpoint data for recovery
 */
export interface Checkpoint {
  id: string;
  state: AgentState;
  context: StateContext;
  transitions: StateTransition[];
  createdAt: string;
  version: number;
}

/**
 * State machine configuration
 */
export interface StateMachineConfig {
  /** Enable automatic checkpointing */
  autoCheckpoint: boolean;
  /** Checkpoint interval in ms */
  checkpointIntervalMs: number;
  /** Maximum transitions to keep in history */
  maxHistorySize: number;
  /** Callback when state changes */
  onStateChange?: (from: AgentState, to: AgentState, context: StateContext) => void;
  /** Callback on invalid transition attempt */
  onInvalidTransition?: (from: AgentState, to: AgentState) => void;
}

const DEFAULT_CONFIG: StateMachineConfig = {
  autoCheckpoint: true,
  checkpointIntervalMs: 60000, // 1 minute
  maxHistorySize: 100,
};

/**
 * Agent State Machine
 *
 * Usage:
 * ```
 * const sm = new StateMachine();
 * await sm.initialize();
 *
 * // Normal operation
 * sm.transition('planning', { goalId: 'goal-1' });
 * sm.transition('executing', { taskId: 'task-1' });
 * sm.transition('verifying');
 * sm.transition('reflecting');
 * sm.transition('idle');
 *
 * // Check state
 * if (sm.getState() === 'blocked') {
 *   // Handle blocked state
 * }
 *
 * // Recovery
 * if (sm.canRecover()) {
 *   await sm.recover();
 * }
 * ```
 */
export class StateMachine {
  private state: AgentState = 'idle';
  private context: StateContext = {};
  private transitions: StateTransition[] = [];
  private config: StateMachineConfig;
  private checkpointId: string;
  private checkpointTimer: NodeJS.Timeout | null = null;
  private version: number = 0;

  constructor(config: Partial<StateMachineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.checkpointId = `checkpoint-${Date.now()}`;

    // Ensure checkpoint directory exists
    mkdirSync(CHECKPOINT_DIR, { recursive: true });
  }

  /**
   * Initialize state machine, potentially recovering from checkpoint
   */
  async initialize(): Promise<void> {
    // Try to recover from last checkpoint
    const checkpoint = this.loadLatestCheckpoint();

    if (checkpoint) {
      console.log(`[StateMachine] Recovering from checkpoint: ${checkpoint.id}`);
      this.state = checkpoint.state;
      this.context = checkpoint.context;
      this.transitions = checkpoint.transitions;
      this.version = checkpoint.version;
      this.checkpointId = checkpoint.id;

      // If we were in an active state, move to error for recovery
      if (['planning', 'executing', 'verifying'].includes(this.state)) {
        this.state = 'error';
        this.context.lastError = 'Recovered from crash - previous state was active';
      }
    }

    // Start auto-checkpointing
    if (this.config.autoCheckpoint) {
      this.startAutoCheckpoint();
    }
  }

  /**
   * Attempt to transition to a new state
   * Returns true if transition was successful
   */
  transition(to: AgentState, contextUpdate?: Partial<StateContext>, reason?: string): boolean {
    const from = this.state;

    // Check if transition is valid
    if (!this.canTransition(to)) {
      console.log(`[StateMachine] Invalid transition: ${from} -> ${to}`);
      if (this.config.onInvalidTransition) {
        this.config.onInvalidTransition(from, to);
      }
      return false;
    }

    // Calculate duration in previous state
    const now = new Date();
    const previousEnteredAt = this.context.stateEnteredAt
      ? new Date(this.context.stateEnteredAt)
      : now;
    const stateDurationMs = now.getTime() - previousEnteredAt.getTime();

    // Update context
    this.context = {
      ...this.context,
      ...contextUpdate,
      stateEnteredAt: now.toISOString(),
      stateDurationMs: 0,
    };

    // Record transition
    const transition: StateTransition = {
      from,
      to,
      context: { ...this.context, stateDurationMs },
      timestamp: now.toISOString(),
      reason,
    };

    this.transitions.push(transition);
    this.version++;

    // Trim history if needed
    if (this.transitions.length > this.config.maxHistorySize) {
      this.transitions = this.transitions.slice(-this.config.maxHistorySize);
    }

    // Update state
    this.state = to;

    console.log(`[StateMachine] ${from} -> ${to}${reason ? ` (${reason})` : ''}`);

    // Callback
    if (this.config.onStateChange) {
      this.config.onStateChange(from, to, this.context);
    }

    // Checkpoint on important transitions
    if (['blocked', 'error', 'shutdown'].includes(to)) {
      this.saveCheckpoint();
    }

    return true;
  }

  /**
   * Check if transition to given state is valid
   */
  canTransition(to: AgentState): boolean {
    return VALID_TRANSITIONS[this.state].includes(to);
  }

  /**
   * Get current state
   */
  getState(): AgentState {
    return this.state;
  }

  /**
   * Get current context
   */
  getContext(): StateContext {
    return { ...this.context };
  }

  /**
   * Update context without changing state
   */
  updateContext(update: Partial<StateContext>): void {
    this.context = { ...this.context, ...update };
  }

  /**
   * Get transition history
   */
  getHistory(): StateTransition[] {
    return [...this.transitions];
  }

  /**
   * Get last N transitions
   */
  getRecentHistory(n: number = 10): StateTransition[] {
    return this.transitions.slice(-n);
  }

  /**
   * Check if in error state and can recover
   */
  canRecover(): boolean {
    return this.state === 'error' && VALID_TRANSITIONS['error'].length > 0;
  }

  /**
   * Attempt recovery from error state
   */
  recover(targetState: AgentState = 'idle'): boolean {
    if (!this.canRecover()) {
      return false;
    }

    return this.transition(targetState, {
      lastError: undefined,
      consecutiveFailures: 0,
    }, 'recovery');
  }

  /**
   * Check if in terminal state
   */
  isTerminal(): boolean {
    return this.state === 'shutdown';
  }

  /**
   * Check if in active state (doing work)
   */
  isActive(): boolean {
    return ['planning', 'executing', 'verifying', 'reflecting'].includes(this.state);
  }

  /**
   * Force state (use with caution, bypasses validation)
   */
  forceState(state: AgentState, context?: StateContext): void {
    console.log(`[StateMachine] FORCE: ${this.state} -> ${state}`);
    this.state = state;
    if (context) {
      this.context = context;
    }
    this.saveCheckpoint();
  }

  /**
   * Save checkpoint to disk
   */
  saveCheckpoint(): void {
    const checkpoint: Checkpoint = {
      id: this.checkpointId,
      state: this.state,
      context: this.context,
      transitions: this.transitions,
      createdAt: new Date().toISOString(),
      version: this.version,
    };

    const path = join(CHECKPOINT_DIR, `${this.checkpointId}.json`);
    writeFileSync(path, JSON.stringify(checkpoint, null, 2));
    console.log(`[StateMachine] Checkpoint saved: ${path}`);

    // Also save as "latest"
    const latestPath = join(CHECKPOINT_DIR, 'latest.json');
    writeFileSync(latestPath, JSON.stringify(checkpoint, null, 2));
  }

  /**
   * Load the most recent checkpoint
   */
  private loadLatestCheckpoint(): Checkpoint | null {
    const latestPath = join(CHECKPOINT_DIR, 'latest.json');

    if (!existsSync(latestPath)) {
      return null;
    }

    try {
      const content = readFileSync(latestPath, 'utf-8');
      return JSON.parse(content) as Checkpoint;
    } catch (err) {
      console.log(`[StateMachine] Failed to load checkpoint: ${err}`);
      return null;
    }
  }

  /**
   * Start automatic checkpointing
   */
  private startAutoCheckpoint(): void {
    this.checkpointTimer = setInterval(() => {
      if (this.isActive()) {
        this.saveCheckpoint();
      }
    }, this.config.checkpointIntervalMs);
  }

  /**
   * Stop the state machine
   */
  stop(): void {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }

    // Final checkpoint
    this.saveCheckpoint();
  }

  /**
   * Get state machine stats
   */
  getStats(): {
    currentState: AgentState;
    statesSinceStart: number;
    errorCount: number;
    avgStateDuration: number;
    uptime: number;
  } {
    const errorCount = this.transitions.filter(t => t.to === 'error').length;

    const durations = this.transitions
      .map(t => t.context.stateDurationMs)
      .filter((d): d is number => d !== undefined);

    const avgStateDuration = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    const firstTransition = this.transitions[0];
    const uptime = firstTransition
      ? Date.now() - new Date(firstTransition.timestamp).getTime()
      : 0;

    return {
      currentState: this.state,
      statesSinceStart: this.transitions.length,
      errorCount,
      avgStateDuration,
      uptime,
    };
  }
}

/**
 * Create a pre-configured state machine
 */
export function createStateMachine(
  onStateChange?: (from: AgentState, to: AgentState, context: StateContext) => void
): StateMachine {
  return new StateMachine({
    autoCheckpoint: true,
    checkpointIntervalMs: 60000,
    maxHistorySize: 100,
    onStateChange,
  });
}
