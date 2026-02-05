/**
 * Status API Server
 *
 * Exposes agent status, metrics, and telemetry via HTTP.
 * Useful for monitoring and debugging.
 *
 * Endpoints:
 * - GET /status - Current agent status
 * - GET /metrics - Telemetry and cost data
 * - GET /health - Simple health check
 * - GET /user-model - User preferences
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { getTelemetry } from '../core/telemetry.js';
import { getUserModel } from '../memory/user-model.js';
import { getConfig, AGENT_DIR, PID_FILE, STATE_FILE, LOG_FILE } from '../core/config.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_PORT = 37778; // One above HutchMem

// ============================================================
// State Accessors
// ============================================================

function getAgentState(): Record<string, unknown> | null {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {
    // Ignore
  }
  return null;
}

function isAgentRunning(): boolean {
  try {
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
      // Check if process exists
      process.kill(pid, 0);
      return true;
    }
  } catch {
    // Process doesn't exist or no access
  }
  return false;
}

function getRecentLogs(lines: number = 50): string[] {
  try {
    if (existsSync(LOG_FILE)) {
      const content = readFileSync(LOG_FILE, 'utf-8');
      return content.split('\n').slice(-lines).filter(l => l.trim());
    }
  } catch {
    // Ignore
  }
  return [];
}

// ============================================================
// Request Handlers
// ============================================================

function handleStatus(res: ServerResponse): void {
  const state = getAgentState();
  const running = isAgentRunning();
  const telemetry = getTelemetry();
  const stats = telemetry.getStats();

  const status = {
    running,
    state: state?.state || 'unknown',
    uptime: state?.startTime ? Date.now() - (state.startTime as number) : 0,
    currentGoal: state?.currentGoal || null,
    currentTask: state?.currentTask || null,
    progress: {
      completed: state?.tasksCompleted || 0,
      total: state?.tasksTotal || 0,
      percentage: state?.progress || 0,
    },
    cycle: {
      count: state?.cycleCount || 0,
      lastCycleTime: state?.lastCycleTime || null,
      consecutiveFailures: state?.consecutiveFailures || 0,
    },
    health: {
      successRate: stats.successRate,
      isHealthy: stats.successRate > 20 && ((state?.consecutiveFailures as number) || 0) < 5,
    },
    cost: {
      today: telemetry.formatCost(stats.costToday),
      total: telemetry.formatCost(stats.costTotal),
    },
    timestamp: new Date().toISOString(),
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(status, null, 2));
}

function handleMetrics(res: ServerResponse): void {
  const telemetry = getTelemetry();
  const stats = telemetry.getStats();
  const toolStats = telemetry.getToolStats();
  const approachStats = telemetry.getApproachStats();
  const errorStats = telemetry.getErrorStats();

  const metrics = {
    lifetime: stats.lifetime,
    today: stats.today,
    summary: {
      successRate: stats.successRate,
      avgCycleTimeMs: stats.avgCycleTimeMs,
      costToday: telemetry.formatCost(stats.costToday),
      costTotal: telemetry.formatCost(stats.costTotal),
    },
    tools: toolStats.slice(0, 10),
    approaches: approachStats,
    errors: errorStats,
    timestamp: new Date().toISOString(),
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(metrics, null, 2));
}

function handleHealth(res: ServerResponse): void {
  const running = isAgentRunning();
  const state = getAgentState();
  const consecutiveFailures = (state?.consecutiveFailures as number) || 0;

  const healthy = running && consecutiveFailures < 5;

  res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: healthy ? 'healthy' : 'unhealthy',
    running,
    consecutiveFailures,
    timestamp: new Date().toISOString(),
  }));
}

function handleUserModel(res: ServerResponse): void {
  const model = getUserModel().getModel();
  const guidelines = getUserModel().getCommunicationGuidelines();
  const corrections = getUserModel().getCorrectionPatterns();

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    communication: model.communication,
    traits: model.traits,
    expertise: model.expertise.slice(0, 10),
    taskPatterns: model.taskPatterns.slice(0, 10),
    guidelines,
    corrections,
    notes: model.notes,
    lastUpdated: new Date(model.lastUpdated).toISOString(),
  }, null, 2));
}

function handleConfig(res: ServerResponse): void {
  const config = getConfig();

  // Redact sensitive info
  const safeConfig = {
    ...config,
    features: config.features,
    urgencyThresholds: config.urgencyThresholds,
    cycleDelays: config.cycleDelays,
    claudeModel: config.claudeModel,
    maxTurns: config.maxTurns,
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(safeConfig, null, 2));
}

function handleLogs(res: ServerResponse, lines: number = 50): void {
  const logs = getRecentLogs(lines);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    lines: logs,
    count: logs.length,
    file: LOG_FILE,
  }));
}

function handleNotFound(res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Not found',
    endpoints: [
      'GET /status - Current agent status',
      'GET /metrics - Telemetry and cost data',
      'GET /health - Simple health check',
      'GET /user-model - User preferences',
      'GET /config - Agent configuration',
      'GET /logs?lines=50 - Recent log lines',
    ],
  }));
}

// ============================================================
// Server
// ============================================================

function requestHandler(req: IncomingMessage, res: ServerResponse): void {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    switch (path) {
      case '/':
      case '/status':
        handleStatus(res);
        break;
      case '/metrics':
        handleMetrics(res);
        break;
      case '/health':
        handleHealth(res);
        break;
      case '/user-model':
        handleUserModel(res);
        break;
      case '/config':
        handleConfig(res);
        break;
      case '/logs':
        const lines = parseInt(url.searchParams.get('lines') || '50', 10);
        handleLogs(res, lines);
        break;
      default:
        handleNotFound(res);
    }
  } catch (err) {
    console.error(`[StatusAPI] Error handling ${path}:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * Start the status API server
 */
export function startStatusServer(port: number = DEFAULT_PORT): void {
  const server = createServer(requestHandler);

  server.listen(port, '127.0.0.1', () => {
    console.log(`[StatusAPI] Server running at http://127.0.0.1:${port}`);
    console.log(`[StatusAPI] Endpoints: /status, /metrics, /health, /user-model, /config, /logs`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[StatusAPI] Port ${port} in use, trying ${port + 1}`);
      startStatusServer(port + 1);
    } else {
      console.error(`[StatusAPI] Server error:`, err);
    }
  });
}

/**
 * Export port for CLI
 */
export const STATUS_API_PORT = DEFAULT_PORT;
