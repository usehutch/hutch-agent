/**
 * NEXUS Reflector
 *
 * The agent's self-awareness - analyzes outcomes, learns from experience,
 * and adjusts strategy. After each action, the reflector:
 * 1. Analyzes what happened
 * 2. Determines what was learned
 * 3. Suggests strategy adjustments
 * 4. Records insights for future reference
 */

import { Plan } from './planner.js';
import { HealthMetrics } from './heartbeat.js';
import { appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const NEXUS_DIR = join(homedir(), '.nexus');
const LOG_FILE = process.env.NEXUS_LOG_FILE || join(NEXUS_DIR, 'nexus.log');

export interface ActionResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

export interface Reflection {
  // What happened
  outcome: 'success' | 'failure' | 'partial';
  summary: string;

  // Analysis
  rootCause?: string;         // Why it failed (if failure)
  keyInsight?: string;        // What we learned
  wasApproachCorrect: boolean;

  // Strategy adjustments
  shouldRetry: boolean;
  suggestedChange?: string;
  newApproach?: string;

  // For memory
  memoryRecord: {
    type: 'feature' | 'bugfix' | 'decision' | 'discovery';
    title: string;
    narrative: string;
    facts: string[];
  };
}

export class Reflector {
  private consecutiveFailures: number = 0;
  private approachHistory: Map<string, { successes: number; failures: number }> = new Map();

  /**
   * Reflect on an action result
   */
  reflect(plan: Plan, result: ActionResult, metrics: HealthMetrics): Reflection {
    const outcome = this.determineOutcome(result);

    // Update approach tracking
    this.trackApproach(plan.approach, outcome === 'success');

    // Analyze the result
    const analysis = this.analyzeResult(plan, result, outcome);

    // Determine if we should retry
    const shouldRetry = this.shouldRetry(plan, result, outcome, metrics);

    // Suggest strategy changes
    const strategy = this.suggestStrategy(plan, result, outcome, metrics);

    // Create memory record
    const memoryRecord = this.createMemoryRecord(plan, result, outcome, analysis);

    // Log the reflection
    this.logReflection(outcome, analysis, strategy);

    return {
      outcome,
      summary: analysis.summary,
      rootCause: analysis.rootCause,
      keyInsight: analysis.keyInsight,
      wasApproachCorrect: analysis.wasApproachCorrect,
      shouldRetry,
      suggestedChange: strategy.suggestedChange,
      newApproach: strategy.newApproach,
      memoryRecord,
    };
  }

  /**
   * Determine the outcome of an action
   */
  private determineOutcome(result: ActionResult): 'success' | 'failure' | 'partial' {
    if (result.success) {
      // Check for partial success indicators
      if (result.output.includes('TASK_BLOCKED') || result.output.includes('warning')) {
        return 'partial';
      }
      return 'success';
    }

    // Check for partial completion even in failure
    if (result.output.includes('TASK_COMPLETE') || result.output.includes('progress')) {
      return 'partial';
    }

    return 'failure';
  }

  /**
   * Track approach success rates
   */
  private trackApproach(approach: string, success: boolean): void {
    const key = approach.split(':')[0].trim();
    const stats = this.approachHistory.get(key) || { successes: 0, failures: 0 };

    if (success) {
      stats.successes++;
      this.consecutiveFailures = 0;
    } else {
      stats.failures++;
      this.consecutiveFailures++;
    }

    this.approachHistory.set(key, stats);
  }

  /**
   * Analyze the result deeply
   */
  private analyzeResult(
    plan: Plan,
    result: ActionResult,
    outcome: 'success' | 'failure' | 'partial'
  ): {
    summary: string;
    rootCause?: string;
    keyInsight?: string;
    wasApproachCorrect: boolean;
  } {
    let summary: string;
    let rootCause: string | undefined;
    let keyInsight: string | undefined;
    let wasApproachCorrect = true;

    if (outcome === 'success') {
      summary = `Successfully completed: ${plan.task.name}`;
      keyInsight = this.extractSuccessInsight(result.output);

    } else if (outcome === 'partial') {
      summary = `Partially completed: ${plan.task.name}`;
      keyInsight = 'Made progress but encountered blockers';

    } else {
      summary = `Failed: ${plan.task.name}`;
      rootCause = this.identifyRootCause(result.error || result.output);
      wasApproachCorrect = !this.wasApproachRelatedFailure(rootCause, plan.approach);

      if (!wasApproachCorrect) {
        keyInsight = `Approach "${plan.approach}" may not be suitable for this task`;
      }
    }

    return { summary, rootCause, keyInsight, wasApproachCorrect };
  }

  /**
   * Extract insight from successful output
   */
  private extractSuccessInsight(output: string): string | undefined {
    // Look for common success patterns
    if (output.includes('test') && output.includes('pass')) {
      return 'Tests are passing';
    }
    if (output.includes('deploy') && output.includes('success')) {
      return 'Deployment successful';
    }
    if (output.includes('commit')) {
      return 'Changes committed';
    }
    return undefined;
  }

  /**
   * Identify root cause of failure
   */
  private identifyRootCause(errorText: string): string {
    const lowerError = errorText.toLowerCase();

    // Common error patterns
    if (lowerError.includes('not found') || lowerError.includes('enoent')) {
      return 'Missing file or dependency';
    }
    if (lowerError.includes('permission denied')) {
      return 'Permission issue';
    }
    if (lowerError.includes('syntax error') || lowerError.includes('parse error')) {
      return 'Syntax error in code';
    }
    if (lowerError.includes('type error') || lowerError.includes('cannot read property')) {
      return 'Type or null reference error';
    }
    if (lowerError.includes('timeout')) {
      return 'Operation timed out';
    }
    if (lowerError.includes('network') || lowerError.includes('connection')) {
      return 'Network or connection issue';
    }
    if (lowerError.includes('out of memory') || lowerError.includes('heap')) {
      return 'Memory exhaustion';
    }

    // Generic
    if (errorText.length > 100) {
      return errorText.slice(0, 100) + '...';
    }
    return errorText || 'Unknown error';
  }

  /**
   * Check if failure was due to approach choice
   */
  private wasApproachRelatedFailure(rootCause: string, approach: string): boolean {
    const cause = rootCause.toLowerCase();
    const approachLower = approach.toLowerCase();

    // Quick approach causing quality issues
    if (approachLower.includes('quick') && (cause.includes('test') || cause.includes('type'))) {
      return true;
    }

    // Cautious approach too slow
    if (approachLower.includes('cautious') && cause.includes('timeout')) {
      return true;
    }

    return false;
  }

  /**
   * Determine if we should retry
   */
  private shouldRetry(
    plan: Plan,
    result: ActionResult,
    outcome: string,
    metrics: HealthMetrics
  ): boolean {
    // Don't retry success
    if (outcome === 'success') return false;

    // Don't retry too many times
    if (this.consecutiveFailures >= 5) return false;

    // Retry partial successes
    if (outcome === 'partial') return true;

    // Retry if it was a transient error
    const transientErrors = ['timeout', 'network', 'connection', 'temporary'];
    const errorLower = (result.error || '').toLowerCase();
    if (transientErrors.some(e => errorLower.includes(e))) {
      return true;
    }

    // Don't retry if deadline is critical
    if (metrics.urgencyLevel === 'critical' && this.consecutiveFailures >= 2) {
      return false;
    }

    // Retry once for other failures
    return this.consecutiveFailures < 2;
  }

  /**
   * Suggest strategy changes
   */
  private suggestStrategy(
    plan: Plan,
    result: ActionResult,
    outcome: string,
    metrics: HealthMetrics
  ): {
    suggestedChange?: string;
    newApproach?: string;
  } {
    if (outcome === 'success') {
      return {};
    }

    // Suggest based on consecutive failures
    if (this.consecutiveFailures >= 3) {
      return {
        suggestedChange: 'Multiple failures - consider breaking task into smaller steps or skipping',
        newApproach: 'step-by-step: Break into tiny verifiable steps',
      };
    }

    // Suggest based on approach history
    const currentApproach = plan.approach.split(':')[0].trim();
    const stats = this.approachHistory.get(currentApproach);

    if (stats && stats.failures > stats.successes * 2) {
      const alternatives = this.getAlternativeApproaches(currentApproach);
      if (alternatives.length > 0) {
        return {
          suggestedChange: `Approach "${currentApproach}" is not working well`,
          newApproach: alternatives[0],
        };
      }
    }

    // Suggest based on error type
    const error = result.error || '';
    if (error.includes('not found')) {
      return {
        suggestedChange: 'Check if dependencies are installed and paths are correct',
      };
    }

    return {};
  }

  /**
   * Get alternative approaches
   */
  private getAlternativeApproaches(current: string): string[] {
    const all = ['standard', 'iterative', 'test-driven', 'step-by-step', 'research-first'];
    return all.filter(a => a !== current);
  }

  /**
   * Create a memory record for HutchMem
   */
  private createMemoryRecord(
    plan: Plan,
    result: ActionResult,
    outcome: string,
    analysis: { summary: string; rootCause?: string; keyInsight?: string }
  ): {
    type: 'feature' | 'bugfix' | 'decision' | 'discovery';
    title: string;
    narrative: string;
    facts: string[];
  } {
    // Determine record type
    let type: 'feature' | 'bugfix' | 'decision' | 'discovery';
    if (outcome === 'success') {
      type = 'feature';
    } else if (outcome === 'failure' && analysis.rootCause) {
      type = 'bugfix';
    } else {
      type = 'discovery';
    }

    // Build facts
    const facts: string[] = [
      `Task: ${plan.task.name}`,
      `Approach: ${plan.approach}`,
      `Outcome: ${outcome}`,
      `Duration: ${result.durationMs}ms`,
    ];

    if (analysis.rootCause) {
      facts.push(`Root cause: ${analysis.rootCause}`);
    }

    if (analysis.keyInsight) {
      facts.push(`Insight: ${analysis.keyInsight}`);
    }

    return {
      type,
      title: analysis.summary,
      narrative: `${plan.task.name} using ${plan.approach} approach. ${outcome === 'success' ? 'Completed successfully.' : `Failed: ${analysis.rootCause || 'unknown reason'}`}`,
      facts,
    };
  }

  /**
   * Log the reflection
   */
  private logReflection(
    outcome: string,
    analysis: { summary: string; rootCause?: string; keyInsight?: string },
    strategy: { suggestedChange?: string; newApproach?: string }
  ): void {
    const icon = outcome === 'success' ? '✓' : outcome === 'partial' ? '~' : '✗';
    const lines = [
      `[REFLECT] ${icon} ${analysis.summary}`,
    ];

    if (analysis.rootCause) {
      lines.push(`[REFLECT]   Root cause: ${analysis.rootCause}`);
    }

    if (analysis.keyInsight) {
      lines.push(`[REFLECT]   Insight: ${analysis.keyInsight}`);
    }

    if (strategy.suggestedChange) {
      lines.push(`[REFLECT]   Suggestion: ${strategy.suggestedChange}`);
    }

    const timestamp = new Date().toISOString();
    for (const line of lines) {
      appendFileSync(LOG_FILE, `[${timestamp}] ${line}\n`);
    }
  }

  /**
   * Get approach statistics
   */
  getApproachStats(): Record<string, { successes: number; failures: number; rate: number }> {
    const stats: Record<string, { successes: number; failures: number; rate: number }> = {};

    for (const [approach, data] of this.approachHistory) {
      const total = data.successes + data.failures;
      stats[approach] = {
        ...data,
        rate: total > 0 ? Math.round((data.successes / total) * 100) : 0,
      };
    }

    return stats;
  }

  /**
   * Get the best performing approach
   */
  getBestApproach(): string | null {
    let best: string | null = null;
    let bestRate = 0;

    for (const [approach, data] of this.approachHistory) {
      const total = data.successes + data.failures;
      if (total >= 3) { // Minimum sample size
        const rate = data.successes / total;
        if (rate > bestRate) {
          bestRate = rate;
          best = approach;
        }
      }
    }

    return best;
  }
}
