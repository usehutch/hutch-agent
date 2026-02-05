/**
 * Stop the Hutch Agent daemon
 */

import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const AGENT_DIR = join(homedir(), '.hutch-agent');
const PID_FILE = join(AGENT_DIR, 'agent.pid');

export async function stop() {
  if (!existsSync(PID_FILE)) {
    console.log('Hutch Agent is not running');
    return;
  }

  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim());

  try {
    // Send SIGTERM for graceful shutdown
    process.kill(pid, 'SIGTERM');
    console.log(`Stopping Hutch Agent (PID: ${pid})...`);

    // Wait for process to exit
    let attempts = 0;
    while (attempts < 30) {
      await new Promise(r => setTimeout(r, 100));
      try {
        process.kill(pid, 0);
        attempts++;
      } catch {
        // Process has exited
        break;
      }
    }

    // Force kill if still running
    try {
      process.kill(pid, 0);
      console.log('Agent not responding, forcing shutdown...');
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already dead
    }

    // Clean up PID file
    unlinkSync(PID_FILE);
    console.log('Hutch Agent stopped');

  } catch (err: any) {
    if (err.code === 'ESRCH') {
      // Process doesn't exist, clean up stale PID file
      unlinkSync(PID_FILE);
      console.log('Hutch Agent was not running (cleaned up stale PID file)');
    } else {
      throw err;
    }
  }
}
