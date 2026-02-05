/**
 * Telemetry and Cost Tracking
 *
 * Tracks agent performance metrics and API costs.
 * Provides observability into agent behavior.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  AGENT_DIR,
  COST_TRACKING_ENABLED,
  TOKEN_COST_INPUT,
  TOKEN_COST_OUTPUT,
} from './config.js';

const TELEMETRY_FILE = join(AGENT_DIR, 'telemetry.json');

// ============================================================
// Types
// ============================================================

export interface CycleMetrics {
  timestamp: number;
  cycleId: string;
  taskName: string;
  durationMs: number;
  success: boolean;
  tokensInput: number;
  tokensOutput: number;
  toolsUsed: string[];
  approach: string;
  errorType?: string;
}

export interface DailyStats {
  date: string; // YYYY-MM-DD
  cycles: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
  tokensInput: number;
  tokensOutput: number;
  estimatedCostCents: number;
  toolUsage: Record<string, number>;
  approachUsage: Record<string, number>;
  errorTypes: Record<string, number>;
}

export interface TelemetryData {
  version: number;
  startedAt: number;
  lastUpdated: number;

  // Lifetime stats
  lifetime: {
    cycles: number;
    successes: number;
    failures: number;
    tokensInput: number;
    tokensOutput: number;
    estimatedCostCents: number;
  };

  // Daily breakdown
  daily: DailyStats[];

  // Recent cycles (for debugging)
  recentCycles: CycleMetrics[];
}

// ============================================================
// Default Data
// ============================================================

const DEFAULT_DATA: TelemetryData = {
  version: 1,
  startedAt: Date.now(),
  lastUpdated: Date.now(),
  lifetime: {
    cycles: 0,
    successes: 0,
    failures: 0,
    tokensInput: 0,
    tokensOutput: 0,
    estimatedCostCents: 0,
  },
  daily: [],
  recentCycles: [],
};

// ============================================================
// Telemetry Manager
// ============================================================

export class TelemetryManager {
  private data: TelemetryData;
  private dirty: boolean = false;

  constructor() {
    this.data = this.load();
  }

  private load(): TelemetryData {
    try {
      if (existsSync(TELEMETRY_FILE)) {
        const content = readFileSync(TELEMETRY_FILE, 'utf-8');
        const loaded = JSON.parse(content) as TelemetryData;
        return { ...DEFAULT_DATA, ...loaded };
      }
    } catch (err) {
      console.log(`[Telemetry] Failed to load: ${(err as Error).message}`);
    }
    return { ...DEFAULT_DATA };
  }

  save(): void {
    try {
      mkdirSync(AGENT_DIR, { recursive: true });
      this.data.lastUpdated = Date.now();
      writeFileSync(TELEMETRY_FILE, JSON.stringify(this.data, null, 2));
      this.dirty = false;
    } catch (err) {
      console.log(`[Telemetry] Failed to save: ${(err as Error).message}`);
    }
  }

  /**
   * Record a cycle completion
   */
  recordCycle(metrics: CycleMetrics): void {
    if (!COST_TRACKING_ENABLED) return;

    // Calculate cost
    const costCents = this.calculateCost(metrics.tokensInput, metrics.tokensOutput);

    // Update lifetime stats
    this.data.lifetime.cycles++;
    if (metrics.success) {
      this.data.lifetime.successes++;
    } else {
      this.data.lifetime.failures++;
    }
    this.data.lifetime.tokensInput += metrics.tokensInput;
    this.data.lifetime.tokensOutput += metrics.tokensOutput;
    this.data.lifetime.estimatedCostCents += costCents;

    // Update daily stats
    const today = new Date().toISOString().split('T')[0];
    let dailyStats = this.data.daily.find(d => d.date === today);

    if (!dailyStats) {
      dailyStats = {
        date: today,
        cycles: 0,
        successes: 0,
        failures: 0,
        totalDurationMs: 0,
        tokensInput: 0,
        tokensOutput: 0,
        estimatedCostCents: 0,
        toolUsage: {},
        approachUsage: {},
        errorTypes: {},
      };
      this.data.daily.push(dailyStats);

      // Keep only last 30 days
      if (this.data.daily.length > 30) {
        this.data.daily.shift();
      }
    }

    dailyStats.cycles++;
    if (metrics.success) {
      dailyStats.successes++;
    } else {
      dailyStats.failures++;
    }
    dailyStats.totalDurationMs += metrics.durationMs;
    dailyStats.tokensInput += metrics.tokensInput;
    dailyStats.tokensOutput += metrics.tokensOutput;
    dailyStats.estimatedCostCents += costCents;

    // Track tool usage
    for (const tool of metrics.toolsUsed) {
      dailyStats.toolUsage[tool] = (dailyStats.toolUsage[tool] || 0) + 1;
    }

    // Track approach usage
    dailyStats.approachUsage[metrics.approach] = (dailyStats.approachUsage[metrics.approach] || 0) + 1;

    // Track error types
    if (metrics.errorType) {
      dailyStats.errorTypes[metrics.errorType] = (dailyStats.errorTypes[metrics.errorType] || 0) + 1;
    }

    // Store recent cycle
    this.data.recentCycles.push(metrics);
    if (this.data.recentCycles.length > 100) {
      this.data.recentCycles.shift();
    }

    this.dirty = true;
  }

  /**
   * Calculate cost in cents
   */
  private calculateCost(inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1_000_000) * TOKEN_COST_INPUT;
    const outputCost = (outputTokens / 1_000_000) * TOKEN_COST_OUTPUT;
    return Math.round((inputCost + outputCost) * 100) / 100;
  }

  /**
   * Get current stats
   */
  getStats(): {
    lifetime: TelemetryData['lifetime'];
    today: DailyStats | null;
    successRate: number;
    avgCycleTimeMs: number;
    costToday: number;
    costTotal: number;
  } {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = this.data.daily.find(d => d.date === today) || null;

    const totalCycles = this.data.lifetime.successes + this.data.lifetime.failures;
    const successRate = totalCycles > 0
      ? Math.round((this.data.lifetime.successes / totalCycles) * 100)
      : 100;

    const avgCycleTimeMs = totalCycles > 0
      ? Math.round(this.data.daily.reduce((sum, d) => sum + d.totalDurationMs, 0) / totalCycles)
      : 0;

    return {
      lifetime: this.data.lifetime,
      today: todayStats,
      successRate,
      avgCycleTimeMs,
      costToday: todayStats?.estimatedCostCents ?? 0,
      costTotal: this.data.lifetime.estimatedCostCents,
    };
  }

  /**
   * Get tool usage stats
   */
  getToolStats(): { tool: string; count: number; percentage: number }[] {
    const toolCounts: Record<string, number> = {};

    for (const cycle of this.data.recentCycles) {
      for (const tool of cycle.toolsUsed) {
        toolCounts[tool] = (toolCounts[tool] || 0) + 1;
      }
    }

    const total = Object.values(toolCounts).reduce((sum, c) => sum + c, 0);

    return Object.entries(toolCounts)
      .map(([tool, count]) => ({
        tool,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get approach effectiveness
   */
  getApproachStats(): { approach: string; count: number; successRate: number }[] {
    const approachData: Record<string, { total: number; successes: number }> = {};

    for (const cycle of this.data.recentCycles) {
      if (!approachData[cycle.approach]) {
        approachData[cycle.approach] = { total: 0, successes: 0 };
      }
      approachData[cycle.approach].total++;
      if (cycle.success) {
        approachData[cycle.approach].successes++;
      }
    }

    return Object.entries(approachData)
      .map(([approach, data]) => ({
        approach,
        count: data.total,
        successRate: data.total > 0 ? Math.round((data.successes / data.total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get error analysis
   */
  getErrorStats(): { errorType: string; count: number; percentage: number }[] {
    const errorCounts: Record<string, number> = {};
    let totalErrors = 0;

    for (const cycle of this.data.recentCycles) {
      if (cycle.errorType) {
        errorCounts[cycle.errorType] = (errorCounts[cycle.errorType] || 0) + 1;
        totalErrors++;
      }
    }

    return Object.entries(errorCounts)
      .map(([errorType, count]) => ({
        errorType,
        count,
        percentage: totalErrors > 0 ? Math.round((count / totalErrors) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Format cost for display
   */
  formatCost(cents: number): string {
    if (cents < 100) {
      return `${cents}¢`;
    }
    return `$${(cents / 100).toFixed(2)}`;
  }

  /**
   * Auto-save if dirty
   */
  autoSave(): void {
    if (this.dirty) {
      this.save();
    }
  }

  /**
   * Get full data (for status endpoint)
   */
  getData(): TelemetryData {
    return this.data;
  }
}

// ============================================================
// Singleton
// ============================================================

let instance: TelemetryManager | null = null;

export function getTelemetry(): TelemetryManager {
  if (!instance) {
    instance = new TelemetryManager();
  }
  return instance;
}
