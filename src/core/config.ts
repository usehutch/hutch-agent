/**
 * Hutch Agent Configuration
 *
 * Centralized configuration loaded from environment variables.
 * All hardcoded values are externalized here with sensible defaults.
 *
 * Environment variables can be set in:
 * - ~/.hutch-agent/.env
 * - System environment
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ============================================================
// Directory Paths
// ============================================================

export const AGENT_DIR = process.env.AGENT_DIR || join(homedir(), '.hutch-agent');
export const GOALS_DIR = process.env.GOALS_DIR || join(AGENT_DIR, 'goals');
export const LOG_FILE = process.env.AGENT_LOG_FILE || join(AGENT_DIR, 'agent.log');
export const STATE_FILE = process.env.AGENT_STATE_FILE || join(AGENT_DIR, 'state.json');
export const PID_FILE = process.env.AGENT_PID_FILE || join(AGENT_DIR, 'agent.pid');
export const CHECKPOINTS_DIR = process.env.CHECKPOINTS_DIR || join(AGENT_DIR, 'checkpoints');
export const COMPLETED_TASKS_FILE = process.env.COMPLETED_TASKS_FILE || join(AGENT_DIR, 'completed-tasks.json');
export const DAG_STATE_FILE = process.env.DAG_STATE_FILE || join(AGENT_DIR, 'dag-state.json');

// ============================================================
// Load .env file
// ============================================================

function loadEnvFile(): Record<string, string> {
  const envPath = join(AGENT_DIR, '.env');
  const env: Record<string, string> = {};

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          env[key] = valueParts.join('=');
        }
      }
    }
  }

  return env;
}

// Load env file once
const envFile = loadEnvFile();

/**
 * Get config value from env file, process.env, or default
 */
function getEnv(key: string, defaultValue: string): string {
  return envFile[key] || process.env[key] || defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = envFile[key] || process.env[key];
  if (value) {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return defaultValue;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = envFile[key] || process.env[key];
  if (value) {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return defaultValue;
}

// ============================================================
// HutchMem Integration
// ============================================================

export const HUTCHMEM_API_URL = getEnv('HUTCHMEM_API_URL', 'http://localhost:37777');
export const HUTCHMEM_TIMEOUT_MS = getEnvNumber('HUTCHMEM_TIMEOUT_MS', 3000);
export const HUTCHMEM_PROJECT = getEnv('HUTCHMEM_PROJECT', 'personal');

// ============================================================
// Claude Execution
// ============================================================

export const CLAUDE_MODEL = getEnv('CLAUDE_MODEL', 'sonnet');
export const MAX_TURNS_PER_CYCLE = getEnvNumber('MAX_TURNS', 50);
export const MAX_CYCLE_TIME_MS = getEnvNumber('MAX_CYCLE_TIME_MS', 15 * 60 * 1000); // 15 minutes
export const STUCK_TIMEOUT_MS = getEnvNumber('STUCK_TIMEOUT_MS', 2 * 60 * 1000); // 2 minutes
export const OUTPUT_FORMAT = getEnv('OUTPUT_FORMAT', 'stream-json');

// ============================================================
// Heartbeat Configuration
// ============================================================

export const HEARTBEAT_INTERVAL_MS = getEnvNumber('HEARTBEAT_INTERVAL_MS', 30000);
export const HEARTBEAT_FAILURE_THRESHOLD = getEnvNumber('HEARTBEAT_FAILURE_THRESHOLD', 3);

// Urgency thresholds (hours until deadline)
export const DEADLINE_CRITICAL_HOURS = getEnvNumber('DEADLINE_CRITICAL_HOURS', 6);
export const DEADLINE_HIGH_HOURS = getEnvNumber('DEADLINE_HIGH_HOURS', 24);
export const DEADLINE_MEDIUM_HOURS = getEnvNumber('DEADLINE_MEDIUM_HOURS', 72);

// Cycle delays based on urgency (milliseconds)
export const CYCLE_DELAY_CRITICAL_MS = getEnvNumber('CYCLE_DELAY_CRITICAL_MS', 2000);
export const CYCLE_DELAY_HIGH_MS = getEnvNumber('CYCLE_DELAY_HIGH_MS', 5000);
export const CYCLE_DELAY_MEDIUM_MS = getEnvNumber('CYCLE_DELAY_MEDIUM_MS', 8000);
export const CYCLE_DELAY_NORMAL_MS = getEnvNumber('CYCLE_DELAY_NORMAL_MS', 10000);
export const CYCLE_DELAY_FAILURE_MS = getEnvNumber('CYCLE_DELAY_FAILURE_MS', 30000);
export const CYCLE_DELAY_ERROR_MS = getEnvNumber('CYCLE_DELAY_ERROR_MS', 30000);

// ============================================================
// Circuit Breaker Configuration
// ============================================================

// Soft thresholds (warnings)
export const CIRCUIT_SOFT_FAILURES = getEnvNumber('CIRCUIT_SOFT_FAILURES', 3);
export const CIRCUIT_SOFT_SIMILARITY_PERCENT = getEnvNumber('CIRCUIT_SOFT_SIMILARITY_PERCENT', 80);
export const CIRCUIT_SOFT_SAME_ERROR_COUNT = getEnvNumber('CIRCUIT_SOFT_SAME_ERROR_COUNT', 3);

// Hard thresholds (blocking)
export const CIRCUIT_HARD_FAILURES = getEnvNumber('CIRCUIT_HARD_FAILURES', 5);
export const MAX_TASK_DURATION_MS = getEnvNumber('MAX_TASK_DURATION_MS', 10 * 60 * 1000); // 10 minutes
export const MAX_TOKENS_PER_TASK = getEnvNumber('MAX_TOKENS_PER_TASK', 50000);

// ============================================================
// State Management
// ============================================================

export const MAX_RECENT_ACTIONS = getEnvNumber('MAX_RECENT_ACTIONS', 50);
export const CHECKPOINT_INTERVAL_MS = getEnvNumber('CHECKPOINT_INTERVAL_MS', 60000); // 1 minute
export const MAX_TRIP_EVENTS = getEnvNumber('MAX_TRIP_EVENTS', 50);
export const MAX_RECENT_CYCLES = getEnvNumber('MAX_RECENT_CYCLES', 20);

// ============================================================
// Scheduler Configuration
// ============================================================

export const MIN_CYCLE_MS = getEnvNumber('MIN_CYCLE_MS', 5000);
export const MAX_CYCLE_MS = getEnvNumber('MAX_CYCLE_MS', 60000);
export const DEFAULT_TASK_RETRIES = getEnvNumber('DEFAULT_TASK_RETRIES', 3);

// ============================================================
// Memory Configuration
// ============================================================

export const MEMORY_SEARCH_LIMIT = getEnvNumber('MEMORY_SEARCH_LIMIT', 10);
export const MEMORY_RELEVANCE_THRESHOLD = getEnvNumber('MEMORY_RELEVANCE_THRESHOLD', 0.5);

// ============================================================
// Telemetry Configuration
// ============================================================

export const TELEMETRY_ENABLED = getEnvBoolean('TELEMETRY_ENABLED', false);
export const TELEMETRY_ENDPOINT = getEnv('TELEMETRY_ENDPOINT', '');
export const COST_TRACKING_ENABLED = getEnvBoolean('COST_TRACKING_ENABLED', true);

// Token costs (per 1M tokens, in cents)
export const TOKEN_COST_INPUT = getEnvNumber('TOKEN_COST_INPUT', 300); // $3/M input
export const TOKEN_COST_OUTPUT = getEnvNumber('TOKEN_COST_OUTPUT', 1500); // $15/M output

// ============================================================
// Feature Flags
// ============================================================

export const ENABLE_DAG_SCHEDULER = getEnvBoolean('ENABLE_DAG_SCHEDULER', false);
export const ENABLE_MULTI_AGENT = getEnvBoolean('ENABLE_MULTI_AGENT', false);
export const ENABLE_MEMORY_EXTRACTION = getEnvBoolean('ENABLE_MEMORY_EXTRACTION', true);
export const ENABLE_USER_MODEL = getEnvBoolean('ENABLE_USER_MODEL', true);

// ============================================================
// Config Object (for passing around)
// ============================================================

export interface AgentConfig {
  // Paths
  agentDir: string;
  goalsDir: string;
  logFile: string;
  stateFile: string;
  pidFile: string;
  checkpointsDir: string;

  // HutchMem
  hutchMemApiUrl: string;
  hutchMemTimeoutMs: number;
  hutchMemProject: string;

  // Claude
  claudeModel: string;
  maxTurns: number;
  maxCycleTimeMs: number;
  stuckTimeoutMs: number;

  // Heartbeat
  heartbeatIntervalMs: number;
  failureThreshold: number;
  urgencyThresholds: {
    critical: number;
    high: number;
    medium: number;
  };
  cycleDelays: {
    critical: number;
    high: number;
    medium: number;
    normal: number;
    failure: number;
    error: number;
  };

  // Circuit Breaker
  circuitBreaker: {
    soft: {
      consecutiveFailures: number;
      outputSimilarityPercent: number;
      sameErrorCount: number;
    };
    hard: {
      consecutiveFailures: number;
      maxTaskDurationMs: number;
      maxTokensPerTask: number;
    };
  };

  // Features
  features: {
    dagScheduler: boolean;
    multiAgent: boolean;
    memoryExtraction: boolean;
    userModel: boolean;
    telemetry: boolean;
    costTracking: boolean;
  };
}

/**
 * Get the full config object
 */
export function getConfig(): AgentConfig {
  return {
    agentDir: AGENT_DIR,
    goalsDir: GOALS_DIR,
    logFile: LOG_FILE,
    stateFile: STATE_FILE,
    pidFile: PID_FILE,
    checkpointsDir: CHECKPOINTS_DIR,

    hutchMemApiUrl: HUTCHMEM_API_URL,
    hutchMemTimeoutMs: HUTCHMEM_TIMEOUT_MS,
    hutchMemProject: HUTCHMEM_PROJECT,

    claudeModel: CLAUDE_MODEL,
    maxTurns: MAX_TURNS_PER_CYCLE,
    maxCycleTimeMs: MAX_CYCLE_TIME_MS,
    stuckTimeoutMs: STUCK_TIMEOUT_MS,

    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    failureThreshold: HEARTBEAT_FAILURE_THRESHOLD,
    urgencyThresholds: {
      critical: DEADLINE_CRITICAL_HOURS,
      high: DEADLINE_HIGH_HOURS,
      medium: DEADLINE_MEDIUM_HOURS,
    },
    cycleDelays: {
      critical: CYCLE_DELAY_CRITICAL_MS,
      high: CYCLE_DELAY_HIGH_MS,
      medium: CYCLE_DELAY_MEDIUM_MS,
      normal: CYCLE_DELAY_NORMAL_MS,
      failure: CYCLE_DELAY_FAILURE_MS,
      error: CYCLE_DELAY_ERROR_MS,
    },

    circuitBreaker: {
      soft: {
        consecutiveFailures: CIRCUIT_SOFT_FAILURES,
        outputSimilarityPercent: CIRCUIT_SOFT_SIMILARITY_PERCENT,
        sameErrorCount: CIRCUIT_SOFT_SAME_ERROR_COUNT,
      },
      hard: {
        consecutiveFailures: CIRCUIT_HARD_FAILURES,
        maxTaskDurationMs: MAX_TASK_DURATION_MS,
        maxTokensPerTask: MAX_TOKENS_PER_TASK,
      },
    },

    features: {
      dagScheduler: ENABLE_DAG_SCHEDULER,
      multiAgent: ENABLE_MULTI_AGENT,
      memoryExtraction: ENABLE_MEMORY_EXTRACTION,
      userModel: ENABLE_USER_MODEL,
      telemetry: TELEMETRY_ENABLED,
      costTracking: COST_TRACKING_ENABLED,
    },
  };
}

/**
 * Print config summary (for debugging)
 */
export function printConfig(): void {
  const config = getConfig();
  console.log('=== Hutch Agent Configuration ===');
  console.log(`Agent Dir: ${config.agentDir}`);
  console.log(`HutchMem: ${config.hutchMemApiUrl}`);
  console.log(`Claude Model: ${config.claudeModel}`);
  console.log(`Max Turns: ${config.maxTurns}`);
  console.log(`Features: DAG=${config.features.dagScheduler} MultiAgent=${config.features.multiAgent} MemExtract=${config.features.memoryExtraction}`);
  console.log('================================');
}

// Export the env loader for use in cycle.ts
export { loadEnvFile };
