/**
 * NEXUS Heartbeat
 *
 * The agent's pulse - monitors health, progress, and adapts behavior.
 * Runs periodically to ensure the agent is functioning well.
 */

import { appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const AGENT_DIR = join(homedir(), '.hutch-agent');
const LOG_FILE = process.env.AGENT_LOG_FILE || join(AGENT_DIR, 'agent.log');

export interface HealthMetrics {
  // Vitals
  isHealthy: boolean;
  uptime: number;              // Seconds since start
  cycleCount: number;

  // Progress
  successRate: number;         // 0-100
  tasksCompleted: number;
  tasksRemaining: number;
  goalProgress: number;        // 0-100

  // Urgency
  deadlineHours: number | null;
  urgencyLevel: 'low' | 'medium' | 'high' | 'critical';

  // Adaptation signals
  shouldSpeedUp: boolean;
  shouldSlowDown: boolean;
  shouldChangeStrategy: boolean;
  consecutiveFailures: number;

  // Resources
  memoryUsageMB: number;
  lastHeartbeat: string;
}

export interface HeartbeatConfig {
  intervalMs: number;          // How often to pulse (default: 30s)
  failureThreshold: number;    // Consecutive failures before strategy change
  urgencyThresholds: {
    critical: number;          // Hours until deadline for critical
    high: number;
    medium: number;
  };
}

const DEFAULT_CONFIG: HeartbeatConfig = {
  intervalMs: 30000,
  failureThreshold: 3,
  urgencyThresholds: {
    critical: 6,   // < 6 hours = critical
    high: 24,      // < 24 hours = high
    medium: 72,    // < 72 hours = medium
  },
};

export class Heartbeat {
  private config: HeartbeatConfig;
  private startTime: number;
  private cycleCount: number = 0;
  private successCount: number = 0;
  private failureCount: number = 0;
  private consecutiveFailures: number = 0;
  private lastHeartbeat: Date = new Date();
  private intervalId: NodeJS.Timeout | null = null;

  // Callbacks
  private onPulse?: (metrics: HealthMetrics) => void;
  private onAlert?: (alert: string, metrics: HealthMetrics) => void;

  constructor(config: Partial<HeartbeatConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startTime = Date.now();
  }

  /**
   * Start the heartbeat
   */
  start(
    onPulse?: (metrics: HealthMetrics) => void,
    onAlert?: (alert: string, metrics: HealthMetrics) => void
  ): void {
    this.onPulse = onPulse;
    this.onAlert = onAlert;

    this.intervalId = setInterval(() => {
      this.pulse();
    }, this.config.intervalMs);

    // Initial pulse
    this.pulse();
  }

  /**
   * Stop the heartbeat
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Record a cycle outcome
   */
  recordCycle(success: boolean): void {
    this.cycleCount++;

    if (success) {
      this.successCount++;
      this.consecutiveFailures = 0;
    } else {
      this.failureCount++;
      this.consecutiveFailures++;
    }
  }

  /**
   * Get current health metrics
   */
  getMetrics(context?: {
    tasksCompleted?: number;
    tasksTotal?: number;
    deadline?: string | null;
  }): HealthMetrics {
    const now = Date.now();
    const uptime = Math.floor((now - this.startTime) / 1000);

    const totalCycles = this.successCount + this.failureCount;
    const successRate = totalCycles > 0
      ? Math.round((this.successCount / totalCycles) * 100)
      : 100;

    const tasksCompleted = context?.tasksCompleted || 0;
    const tasksTotal = context?.tasksTotal || 1;
    const tasksRemaining = tasksTotal - tasksCompleted;
    const goalProgress = Math.round((tasksCompleted / tasksTotal) * 100);

    // Calculate deadline urgency
    let deadlineHours: number | null = null;
    let urgencyLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';

    if (context?.deadline) {
      const deadline = new Date(context.deadline);
      const hoursRemaining = (deadline.getTime() - now) / (1000 * 60 * 60);
      deadlineHours = Math.max(0, Math.round(hoursRemaining * 10) / 10);

      if (deadlineHours < this.config.urgencyThresholds.critical) {
        urgencyLevel = 'critical';
      } else if (deadlineHours < this.config.urgencyThresholds.high) {
        urgencyLevel = 'high';
      } else if (deadlineHours < this.config.urgencyThresholds.medium) {
        urgencyLevel = 'medium';
      }
    }

    // Determine adaptation signals
    const shouldSpeedUp = urgencyLevel === 'critical' || urgencyLevel === 'high';
    const shouldSlowDown = successRate < 30 && this.cycleCount > 5;
    const shouldChangeStrategy = this.consecutiveFailures >= this.config.failureThreshold;

    // Health check
    const isHealthy =
      successRate > 20 &&
      this.consecutiveFailures < this.config.failureThreshold * 2;

    // Memory usage
    const memoryUsage = process.memoryUsage();
    const memoryUsageMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);

    this.lastHeartbeat = new Date();

    return {
      isHealthy,
      uptime,
      cycleCount: this.cycleCount,
      successRate,
      tasksCompleted,
      tasksRemaining,
      goalProgress,
      deadlineHours,
      urgencyLevel,
      shouldSpeedUp,
      shouldSlowDown,
      shouldChangeStrategy,
      consecutiveFailures: this.consecutiveFailures,
      memoryUsageMB,
      lastHeartbeat: this.lastHeartbeat.toISOString(),
    };
  }

  /**
   * Pulse - run health check and notify
   */
  private pulse(): void {
    const metrics = this.getMetrics();

    // Log heartbeat
    const status = metrics.isHealthy ? '♥' : '⚠';
    this.log(`${status} Heartbeat | Uptime: ${this.formatUptime(metrics.uptime)} | Success: ${metrics.successRate}% | Cycles: ${metrics.cycleCount}`);

    // Check for alerts
    if (!metrics.isHealthy) {
      this.alert('Agent health degraded', metrics);
    }

    if (metrics.shouldChangeStrategy) {
      this.alert(`Strategy change needed: ${metrics.consecutiveFailures} consecutive failures`, metrics);
    }

    if (metrics.urgencyLevel === 'critical') {
      this.alert(`CRITICAL: Only ${metrics.deadlineHours}h until deadline!`, metrics);
    }

    // Notify callback
    if (this.onPulse) {
      this.onPulse(metrics);
    }
  }

  /**
   * Send an alert
   */
  private alert(message: string, metrics: HealthMetrics): void {
    this.log(`ALERT: ${message}`);

    if (this.onAlert) {
      this.onAlert(message, metrics);
    }
  }

  /**
   * Log to file
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [HEARTBEAT] ${message}\n`;
    appendFileSync(LOG_FILE, line);
  }

  /**
   * Format uptime nicely
   */
  private formatUptime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
  }

  /**
   * Get recommended cycle delay based on current state
   */
  getRecommendedDelay(): number {
    const metrics = this.getMetrics();

    // Speed up if urgent
    if (metrics.urgencyLevel === 'critical') return 2000;   // 2s
    if (metrics.urgencyLevel === 'high') return 5000;       // 5s

    // Slow down if failing
    if (metrics.consecutiveFailures >= 3) return 30000;     // 30s
    if (metrics.consecutiveFailures >= 1) return 15000;     // 15s

    // Normal pace
    if (metrics.urgencyLevel === 'medium') return 8000;     // 8s
    return 10000;                                           // 10s default
  }
}
