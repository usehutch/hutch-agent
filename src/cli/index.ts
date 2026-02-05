#!/usr/bin/env bun
/**
 * Hutch Agent CLI
 *
 * 24/7 Autonomous AI Agent powered by HutchMem
 *
 * Usage:
 *   hutch agent start   - Start the agent daemon
 *   hutch agent stop    - Stop the agent
 *   hutch agent status  - Check agent status
 *   hutch agent logs    - View agent logs
 */

import { start } from './start.js';
import { stop } from './stop.js';
import { status } from './status.js';
import { logs } from './logs.js';

const command = process.argv[2];

async function main() {
  switch (command) {
    case 'start':
      await start();
      break;

    case 'stop':
      await stop();
      break;

    case 'status':
      await status();
      break;

    case 'logs':
      await logs();
      break;

    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;

    default:
      if (command) {
        console.error(`Unknown command: ${command}`);
      }
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
Hutch Agent - 24/7 Autonomous AI Agent

Usage: hutch agent <command>

Commands:
  start   Start the agent daemon
  stop    Stop the agent gracefully
  status  Show agent status and progress
  logs    Stream agent activity logs
  help    Show this help message

Examples:
  hutch agent start          # Start the agent
  hutch agent status         # Check what agent is doing
  hutch agent logs           # Watch agent activity
  hutch agent stop           # Stop the agent
`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
