/**
 * NEXUS Circuit Breaker
 *
 * Advanced loop prevention with two threshold levels:
 * - SOFT: Warns and suggests strategy change
 * - HARD: Blocks execution and requires intervention
 *
 * Detects stuck states via:
 * - Consecutive failures
 * - Output similarity (agent producing same output repeatedly)
 * - Same error repeated
 * - Task duration exceeded
 * - Token budget exceeded
 */

import { appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const AGENT_DIR = join(homedir(), '.hutch-agent');
const LOG_FILE = process.env.AGENT_LOG_FILE || join(AGENT_DIR, 'agent.log');

/**
 * Circuit breaker thresholds configuration
 */
export interface CircuitBreakerConfig {
  soft: {
    /** Max consecutive failures before warning */
    consecutiveFailures: number;
    /** Minimum similarity % to consider outputs the same */
    outputSimilarityPercent: number;
    /** Max times same error can repeat before warning */
    sameErrorCount: number;
  };
  hard: {
    /** Max consecutive failures before blocking */
    consecutiveFailures: number;
    /** Max duration (ms) for a single task */
    maxTaskDurationMs: number;
    /** Max tokens per task before blocking */
    maxTokensPerTask: number;
  };
}

/**
 * Circuit breaker state levels
 */
export type CircuitState = 'closed' | 'soft_open' | 'hard_open';

/**
 * Reason why the circuit breaker tripped
 */
export type TripReason =
  | 'consecutive_failures'
  | 'output_similarity'
  | 'same_error'
  | 'task_duration'
  | 'token_budget'
  | 'manual';

/**
 * Trip event details
 */
export interface TripEvent {
  level: 'soft' | 'hard';
  reason: TripReason;
  message: string;
  timestamp: string;
  taskId?: string;
  currentCount?: number;
  threshold?: number;
}

/**
 * Cycle record for tracking
 */
interface CycleRecord {
  taskId: string;
  output: string;
  error?: string;
  success: boolean;
  tokensUsed: number;
  durationMs: number;
  timestamp: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  soft: {
    consecutiveFailures: 3,
    outputSimilarityPercent: 80,
    sameErrorCount: 3,
  },
  hard: {
    consecutiveFailures: 5,
    maxTaskDurationMs: 600000, // 10 minutes
    maxTokensPerTask: 50000,
  },
};

/**
 * Circuit Breaker implementation
 *
 * Usage:
 * ```
 * const breaker = new CircuitBreaker();
 *
 * // Before executing a cycle
 * if (breaker.shouldBlock()) {
 *   // Handle blocked state - need intervention
 *   return;
 * }
 *
 * // After executing a cycle
 * breaker.recordCycle({
 *   taskId: 'task-1',
 *   output: result.output,
 *   error: result.error,
 *   success: result.success,
 *   tokensUsed: result.tokens,
 *   durationMs: duration
 * });
 *
 * // Check warnings
 * if (breaker.shouldWarn()) {
 *   const trip = breaker.getLastTrip();
 *   // Handle warning - suggest strategy change
 * }
 * ```
 */
export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState = 'closed';
  private currentTaskId: string | null = null;
  private taskStartTime: number = 0;
  private taskTokensUsed: number = 0;

  // History tracking
  private recentCycles: CycleRecord[] = [];
  private consecutiveFailures: number = 0;
  private tripEvents: TripEvent[] = [];

  // Callbacks
  private onTrip?: (event: TripEvent) => void;
  private onReset?: () => void;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      soft: { ...DEFAULT_CONFIG.soft, ...config.soft },
      hard: { ...DEFAULT_CONFIG.hard, ...config.hard },
    };
  }

  /**
   * Set callbacks for trip and reset events
   */
  setCallbacks(
    onTrip?: (event: TripEvent) => void,
    onReset?: () => void
  ): void {
    this.onTrip = onTrip;
    this.onReset = onReset;
  }

  /**
   * Start tracking a new task
   */
  startTask(taskId: string): void {
    this.currentTaskId = taskId;
    this.taskStartTime = Date.now();
    this.taskTokensUsed = 0;
  }

  /**
   * Add tokens used in current task
   */
  addTokens(count: number): void {
    this.taskTokensUsed += count;

    // Check hard token limit
    if (this.taskTokensUsed >= this.config.hard.maxTokensPerTask) {
      this.trip('hard', 'token_budget',
        `Token budget exceeded: ${this.taskTokensUsed} >= ${this.config.hard.maxTokensPerTask}`);
    }
  }

  /**
   * Record the outcome of a cycle
   */
  recordCycle(record: Omit<CycleRecord, 'timestamp'>): void {
    const cycle: CycleRecord = {
      ...record,
      timestamp: Date.now(),
    };

    // Check task duration limit
    if (this.currentTaskId === record.taskId) {
      const taskDuration = Date.now() - this.taskStartTime;
      if (taskDuration >= this.config.hard.maxTaskDurationMs) {
        this.trip('hard', 'task_duration',
          `Task duration exceeded: ${Math.round(taskDuration / 1000)}s >= ${this.config.hard.maxTaskDurationMs / 1000}s`);
      }
    }

    // Track consecutive failures
    if (record.success) {
      this.consecutiveFailures = 0;
      this.maybeReset();
    } else {
      this.consecutiveFailures++;
      this.checkFailureThresholds();
    }

    // Store cycle
    this.recentCycles.push(cycle);
    if (this.recentCycles.length > 20) {
      this.recentCycles.shift();
    }

    // Check for loops
    this.checkOutputSimilarity();
    this.checkRepeatedErrors();
  }

  /**
   * Check if execution should be blocked (hard open)
   */
  shouldBlock(): boolean {
    return this.state === 'hard_open';
  }

  /**
   * Check if a warning should be shown (soft open)
   */
  shouldWarn(): boolean {
    return this.state === 'soft_open';
  }

  /**
   * Get the current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get the last trip event
   */
  getLastTrip(): TripEvent | null {
    return this.tripEvents.length > 0
      ? this.tripEvents[this.tripEvents.length - 1]
      : null;
  }

  /**
   * Get all trip events
   */
  getTripHistory(): TripEvent[] {
    return [...this.tripEvents];
  }

  /**
   * Get current statistics
   */
  getStats(): {
    state: CircuitState;
    consecutiveFailures: number;
    currentTaskTokens: number;
    currentTaskDurationMs: number;
    recentCycleCount: number;
  } {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      currentTaskTokens: this.taskTokensUsed,
      currentTaskDurationMs: this.currentTaskId ? Date.now() - this.taskStartTime : 0,
      recentCycleCount: this.recentCycles.length,
    };
  }

  /**
   * Manually reset the circuit breaker
   * Call after intervention/strategy change
   */
  reset(): void {
    const previousState = this.state;
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.taskTokensUsed = 0;

    if (previousState !== 'closed') {
      this.log(`Circuit breaker reset from ${previousState}`);
      if (this.onReset) {
        this.onReset();
      }
    }
  }

  /**
   * Manually trip the circuit breaker (e.g., from external signal)
   */
  manualTrip(level: 'soft' | 'hard', message: string): void {
    this.trip(level, 'manual', message);
  }

  // ============================================================
  // Private methods
  // ============================================================

  private trip(level: 'soft' | 'hard', reason: TripReason, message: string): void {
    // Don't downgrade from hard to soft
    if (this.state === 'hard_open' && level === 'soft') {
      return;
    }

    const event: TripEvent = {
      level,
      reason,
      message,
      timestamp: new Date().toISOString(),
      taskId: this.currentTaskId || undefined,
    };

    this.state = level === 'hard' ? 'hard_open' : 'soft_open';
    this.tripEvents.push(event);

    // Keep last 50 events
    if (this.tripEvents.length > 50) {
      this.tripEvents.shift();
    }

    this.log(`CIRCUIT ${level.toUpperCase()}: ${message}`);

    if (this.onTrip) {
      this.onTrip(event);
    }
  }

  private maybeReset(): void {
    // Auto-reset soft open after a success
    if (this.state === 'soft_open' && this.consecutiveFailures === 0) {
      this.state = 'closed';
      this.log('Circuit breaker auto-reset after success');
    }
  }

  private checkFailureThresholds(): void {
    // Check hard threshold first
    if (this.consecutiveFailures >= this.config.hard.consecutiveFailures) {
      this.trip('hard', 'consecutive_failures',
        `${this.consecutiveFailures} consecutive failures (hard limit: ${this.config.hard.consecutiveFailures})`);
      return;
    }

    // Check soft threshold
    if (this.consecutiveFailures >= this.config.soft.consecutiveFailures) {
      this.trip('soft', 'consecutive_failures',
        `${this.consecutiveFailures} consecutive failures (soft limit: ${this.config.soft.consecutiveFailures})`);
    }
  }

  private checkOutputSimilarity(): void {
    if (this.recentCycles.length < 3) return;

    // Get last 5 cycles
    const recent = this.recentCycles.slice(-5);
    const outputs = recent.map(c => c.output).filter(o => o && o.length > 50);

    if (outputs.length < 3) return;

    // Check if recent outputs are too similar
    let similarCount = 0;
    const reference = outputs[outputs.length - 1];

    for (let i = 0; i < outputs.length - 1; i++) {
      const similarity = this.calculateSimilarity(reference, outputs[i]);
      if (similarity >= this.config.soft.outputSimilarityPercent) {
        similarCount++;
      }
    }

    // If 3+ of last 5 outputs are very similar, we're likely in a loop
    if (similarCount >= 2) {
      this.trip('soft', 'output_similarity',
        `Output similarity detected: ${similarCount + 1} of ${outputs.length} outputs are ${this.config.soft.outputSimilarityPercent}%+ similar`);
    }
  }

  private checkRepeatedErrors(): void {
    if (this.recentCycles.length < 3) return;

    // Get last 5 error messages
    const recentErrors = this.recentCycles
      .slice(-5)
      .map(c => c.error)
      .filter((e): e is string => !!e);

    if (recentErrors.length < this.config.soft.sameErrorCount) return;

    // Count occurrences of each error pattern
    const errorCounts = new Map<string, number>();
    for (const error of recentErrors) {
      // Normalize error for comparison (remove timestamps, line numbers, etc.)
      const normalized = this.normalizeError(error);
      errorCounts.set(normalized, (errorCounts.get(normalized) || 0) + 1);
    }

    // Check if any error repeated too many times
    for (const [error, count] of errorCounts) {
      if (count >= this.config.soft.sameErrorCount) {
        this.trip('soft', 'same_error',
          `Same error repeated ${count} times: "${error.substring(0, 100)}..."`);
        break;
      }
    }
  }

  private calculateSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;

    // Simple Jaccard similarity on word sets (fast approximation)
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) intersection++;
    }

    const union = wordsA.size + wordsB.size - intersection;
    return Math.round((intersection / union) * 100);
  }

  private normalizeError(error: string): string {
    return error
      // Remove timestamps
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*Z?/g, 'TIMESTAMP')
      // Remove line numbers
      .replace(/:\d+:\d+/g, ':LINE')
      // Remove file paths
      .replace(/\/[\w\/-]+\.(ts|js|json)/g, 'FILE')
      // Remove UUIDs
      .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, 'UUID')
      // Truncate and normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200);
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [CIRCUIT] ${message}\n`;
    try {
      appendFileSync(LOG_FILE, line);
    } catch {
      // Ignore log errors
    }
  }
}

/**
 * Create a pre-configured circuit breaker for common use cases
 */
export function createCircuitBreaker(
  type: 'default' | 'aggressive' | 'lenient' = 'default'
): CircuitBreaker {
  switch (type) {
    case 'aggressive':
      return new CircuitBreaker({
        soft: { consecutiveFailures: 2, outputSimilarityPercent: 70, sameErrorCount: 2 },
        hard: { consecutiveFailures: 3, maxTaskDurationMs: 300000, maxTokensPerTask: 30000 },
      });
    case 'lenient':
      return new CircuitBreaker({
        soft: { consecutiveFailures: 5, outputSimilarityPercent: 90, sameErrorCount: 5 },
        hard: { consecutiveFailures: 8, maxTaskDurationMs: 900000, maxTokensPerTask: 100000 },
      });
    default:
      return new CircuitBreaker();
  }
}
