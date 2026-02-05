/**
 * Show Hutch Agent status
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const AGENT_DIR = join(homedir(), '.hutch-agent');
const PID_FILE = join(AGENT_DIR, 'agent.pid');
const STATE_FILE = join(AGENT_DIR, 'state.json');
const LOG_FILE = join(AGENT_DIR, 'agent.log');

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

export async function status() {
  console.log('Hutch Agent Status');
  console.log('==================');
  console.log('');

  // Check if running
  let running = false;
  let pid: number | null = null;

  if (existsSync(PID_FILE)) {
    pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim());
    try {
      process.kill(pid, 0);
      running = true;
    } catch {
      running = false;
    }
  }

  if (running) {
    console.log(`Status:  RUNNING (PID: ${pid})`);
  } else {
    console.log('Status:  STOPPED');
    console.log('');
    console.log('Start the agent with: hutch agent start');
    return;
  }

  // Load state
  if (existsSync(STATE_FILE)) {
    try {
      const state: AgentState = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));

      console.log(`Started: ${state.startedAt}`);
      console.log(`Cycles:  ${state.cycleCount}`);

      if (state.lastCycleAt) {
        const lastCycle = new Date(state.lastCycleAt);
        const now = new Date();
        const diffMs = now.getTime() - lastCycle.getTime();
        const diffSecs = Math.floor(diffMs / 1000);
        console.log(`Last:    ${diffSecs}s ago`);
      }

      console.log('');

      if (state.currentGoal) {
        console.log(`Current Goal: ${state.currentGoal}`);
      }

      if (state.currentTask) {
        console.log(`Current Task: ${state.currentTask}`);
      }

      console.log('');

      // Progress
      if (Object.keys(state.progress).length > 0) {
        console.log('Progress:');
        for (const [objective, percent] of Object.entries(state.progress)) {
          const bar = '='.repeat(Math.floor(percent / 5)) + '-'.repeat(20 - Math.floor(percent / 5));
          console.log(`  ${objective}: [${bar}] ${percent}%`);
        }
        console.log('');
      }

      // Recent actions
      if (state.recentActions && state.recentActions.length > 0) {
        console.log('Recent Actions:');
        for (const action of state.recentActions.slice(-5)) {
          const icon = action.outcome === 'success' ? '✓' : '✗';
          console.log(`  ${icon} ${action.action}`);
        }
      }

    } catch (err) {
      console.log('(Unable to read state)');
    }
  } else {
    console.log('(No state file found - agent may be initializing)');
  }

  console.log('');
  console.log('Use "hutch agent logs" to watch activity');
}
