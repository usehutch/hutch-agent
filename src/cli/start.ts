/**
 * Start the NEXUS agent daemon
 */

import { existsSync, writeFileSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const NEXUS_DIR = join(homedir(), '.nexus');
const PID_FILE = join(NEXUS_DIR, 'nexus.pid');
const LOG_FILE = join(NEXUS_DIR, 'nexus.log');

export async function start() {
  // Check if already running
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim());
    try {
      process.kill(pid, 0); // Check if process exists
      console.log(`NEXUS agent already running (PID: ${pid})`);
      console.log('Use "hutch nexus status" to check progress');
      return;
    } catch {
      // PID file exists but process is dead, clean up
    }
  }

  // Ensure .nexus directory exists
  const { mkdirSync } = await import('fs');
  mkdirSync(NEXUS_DIR, { recursive: true });

  console.log('Starting NEXUS agent...');

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
        NEXUS_LOG_FILE: LOG_FILE,
      },
    });

    // Write PID file
    writeFileSync(PID_FILE, String(child.pid));

    // Detach
    child.unref();

    console.log(`NEXUS agent started (PID: ${child.pid})`);
    console.log(`Logs: ${LOG_FILE}`);
    console.log('');
    console.log('Use "hutch nexus status" to check progress');
    console.log('Use "hutch nexus logs" to watch activity');
    console.log('Use "hutch nexus stop" to stop the agent');
  }
}
