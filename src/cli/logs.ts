/**
 * Stream Hutch Agent logs
 */

import { existsSync, readFileSync, watchFile, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';

const AGENT_DIR = join(homedir(), '.hutch-agent');
const LOG_FILE = join(AGENT_DIR, 'agent.log');

export async function logs() {
  // Check if log file exists
  if (!existsSync(LOG_FILE)) {
    console.log('No logs found. Is the agent running?');
    console.log('');
    console.log('Start the agent with: hutch agent start');
    return;
  }

  // Get flags
  const follow = !process.argv.includes('--no-follow');
  const lines = parseInt(process.argv.find(a => a.startsWith('-n'))?.slice(2) || '50');

  console.log(`Showing last ${lines} lines from ${LOG_FILE}`);
  if (follow) {
    console.log('(Ctrl+C to stop following)');
  }
  console.log('---');
  console.log('');

  if (follow) {
    // Use tail -f for following
    const tail = spawn('tail', ['-n', String(lines), '-f', LOG_FILE], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      tail.kill();
      console.log('');
      process.exit(0);
    });

    await new Promise<void>(resolve => {
      tail.on('exit', () => resolve());
    });

  } else {
    // Just show last N lines
    const content = readFileSync(LOG_FILE, 'utf-8');
    const allLines = content.trim().split('\n');
    const lastLines = allLines.slice(-lines);
    console.log(lastLines.join('\n'));
  }
}
