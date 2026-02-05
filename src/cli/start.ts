/**
 * Start the Hutch Agent daemon
 */

import { existsSync, writeFileSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const AGENT_DIR = join(homedir(), '.hutch-agent');
const PID_FILE = join(AGENT_DIR, 'agent.pid');
const LOG_FILE = join(AGENT_DIR, 'agent.log');

export async function start() {
  // Check if already running
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim());
    try {
      process.kill(pid, 0); // Check if process exists
      console.log(`Hutch Agent already running (PID: ${pid})`);
      console.log('Use "hutch agent status" to check progress');
      return;
    } catch {
      // PID file exists but process is dead, clean up
    }
  }

  // Ensure agent directory exists
  const { mkdirSync } = await import('fs');
  mkdirSync(AGENT_DIR, { recursive: true });

  console.log('Starting Hutch Agent...');

  // Check for foreground flag
  const foreground = process.argv.includes('--foreground') || process.argv.includes('-f');

  if (foreground) {
    // Run in foreground
    console.log('Running in foreground mode (Ctrl+C to stop)');
    console.log('');

    // Import and run the loop directly
    const { runLoop } = await import('../core/loop.js');
    await runLoop();
  } else {
    // Spawn as daemon
    const loopPath = join(__dirname, '../core/loop.ts');

    const child = spawn('bun', ['run', loopPath], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        AGENT_LOG_FILE: LOG_FILE,
      },
    });

    // Write PID file
    writeFileSync(PID_FILE, String(child.pid));

    // Detach
    child.unref();

    console.log(`Hutch Agent started (PID: ${child.pid})`);
    console.log(`Logs: ${LOG_FILE}`);
    console.log('');
    console.log('Use "hutch agent status" to check progress');
    console.log('Use "hutch agent logs" to watch activity');
    console.log('Use "hutch agent stop" to stop the agent');
  }
}
