# NEXUS Agent

24/7 Autonomous AI Agent powered by HutchMem

## Overview

NEXUS is an autonomous agent that runs continuously, learning from every action and improving over time. It uses HutchMem for persistent memory across sessions.

## Usage

```bash
# Start the agent
bun run nexus start

# Check status
bun run nexus status

# View logs
bun run nexus logs

# Stop the agent
bun run nexus stop
```

## How It Works

1. **PERCEIVE** - Agent gathers state and memory context
2. **THINK** - Claude decides next action based on goal + memory
3. **ACT** - Execute action via Claude Code CLI
4. **LEARN** - HutchMem hooks record the action and outcome
5. **ADAPT** - Adjust strategy if needed
6. **REPEAT** - Forever

## Memory Integration

NEXUS uses the existing HutchMem infrastructure:

- **SessionStart hook** - Injects past observations as context
- **PostToolUse hook** - Records each tool action
- **Stop hook** - Summarizes the session

This means the agent gets smarter with every cycle.

## Goals

Goals are defined in `goals/*.json` files. Each goal has:

- Name and description
- Deadline (optional)
- Priority (1 = highest)
- Tasks to complete
- Constraints

## Architecture

```
NEXUS Agent
├── CLI (start/stop/status/logs)
├── Core Loop (24/7)
│   ├── Perceive (state + memory)
│   ├── Think (Claude reasoning)
│   ├── Act (Claude Code CLI)
│   ├── Learn (HutchMem hooks)
│   └── Adapt (strategy adjustment)
├── Scheduler (goals + tasks)
└── HutchMem (persistent memory)
```

## License

MIT
