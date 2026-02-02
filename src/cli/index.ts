#!/usr/bin/env bun
/**
 * NEXUS Agent CLI
 *
 * 24/7 Autonomous AI Agent powered by HutchMem
 *
 * Usage:
 *   hutch nexus start   - Start the agent daemon
 *   hutch nexus stop    - Stop the agent
 *   hutch nexus status  - Check agent status
 *   hutch nexus logs    - View agent logs
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
NEXUS Agent - 24/7 Autonomous AI Agent

Usage: hutch nexus <command>

Commands:
  start   Start the agent daemon
  stop    Stop the agent gracefully
  status  Show agent status and progress
  logs    Stream agent activity logs
  help    Show this help message

Examples:
  hutch nexus start          # Start the agent
  hutch nexus status         # Check what agent is doing
  hutch nexus logs           # Watch agent activity
  hutch nexus stop           # Stop the agent
`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
