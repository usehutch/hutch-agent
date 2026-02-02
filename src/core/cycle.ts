/**
 * Single Agent Cycle
 *
 * Runs one iteration of the agent using Claude Code CLI.
 * HutchMem hooks automatically handle:
 * - Context injection (SessionStart)
 * - Action recording (PostToolUse)
 * - Session summary (Stop)
 */

import { spawn } from 'child_process';
import { Goal, Task, Scheduler } from '../scheduler/scheduler.js';
import { getSystemPrompt } from '../prompts/system.js';

interface CycleInput {
  goal: Goal;
  task: Task | null;
  state: {
    cycleCount: number;
    recentActions: Array<{
      action: string;
      outcome: 'success' | 'failure';
    }>;
  };
  scheduler: Scheduler;
  customPrompt?: string;  // Optional custom prompt from planner
}

interface CycleResult {
  action: string;
  success: boolean;
  error?: string;
  output?: string;
}

/**
 * Run a single cycle using Claude Code CLI
 *
 * This spawns `claude` with a prompt that includes:
 * - Current goal and task
 * - Instructions for the agent
 *
 * HutchMem hooks handle memory automatically.
 */
export async function runCycle(input: CycleInput): Promise<CycleResult> {
  const { goal, task, state, scheduler, customPrompt } = input;

  // Use custom prompt from planner if provided, otherwise build default
  const prompt = customPrompt || buildCyclePrompt(goal, task, state);

  try {
    // Run claude code with the prompt
    const result = await runClaudeCode(prompt, {
      cwd: goal.workingDirectory || process.cwd(),
      maxTurns: 50,
    });

    // Determine what action was taken from output
    const action = extractAction(result.output) || task?.name || 'unknown action';

    // Check if task completed
    if (task && result.success) {
      scheduler.markTaskCompleted(goal.id, task.id);
    }

    return {
      action,
      success: result.success,
      output: result.output,
      error: result.error,
    };

  } catch (err: any) {
    return {
      action: task?.name || 'cycle',
      success: false,
      error: err.message,
    };
  }
}

/**
 * Build the prompt for a cycle
 */
function buildCyclePrompt(
  goal: Goal,
  task: Task | null,
  state: { cycleCount: number; recentActions: Array<{ action: string; outcome: string }> }
): string {
  const systemPrompt = getSystemPrompt();

  let prompt = `${systemPrompt}

## Current Goal
${goal.name}
${goal.description || ''}

## Current Task
${task ? task.name : 'No specific task - analyze the goal and determine next steps'}
${task?.description || ''}

## Context
- Cycle: ${state.cycleCount}
- Recent actions: ${state.recentActions.slice(-5).map(a => `${a.action} (${a.outcome})`).join(', ') || 'none'}

## Instructions
1. Focus on the current task
2. Use tools to make progress (Write, Edit, Bash, etc.)
3. Test your changes when applicable
4. Commit your work with reasoning in the message
5. If task is complete, say "TASK_COMPLETE"
6. If blocked, explain why and say "TASK_BLOCKED"

Begin working on the task.
`;

  return prompt;
}

/**
 * Run Claude Code CLI with a prompt
 */
async function runClaudeCode(
  prompt: string,
  options: {
    cwd?: string;
    maxTurns?: number;
  }
): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    const args = [
      '--print',  // Non-interactive mode
      '--dangerously-skip-permissions',  // Auto-approve (for autonomous operation)
      prompt,
    ];

    const claude = spawn('claude', args, {
      cwd: options.cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Ensure HutchMem hooks are active
        CLAUDE_CODE_HOOKS: 'true',
      },
    });

    let stdout = '';
    let stderr = '';

    claude.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    claude.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    claude.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout,
        error: code !== 0 ? stderr || `Exit code: ${code}` : undefined,
      });
    });

    claude.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message,
      });
    });

    // Timeout after 10 minutes
    setTimeout(() => {
      claude.kill('SIGTERM');
      resolve({
        success: false,
        output: stdout,
        error: 'Cycle timeout (10 minutes)',
      });
    }, 10 * 60 * 1000);
  });
}

/**
 * Extract the main action from Claude's output
 */
function extractAction(output: string): string | null {
  // Look for common action patterns
  const patterns = [
    /Created? (?:file )?[`"]?([^`"\n]+)[`"]?/i,
    /Wrote? (?:to )?[`"]?([^`"\n]+)[`"]?/i,
    /Edit(?:ed|ing)? [`"]?([^`"\n]+)[`"]?/i,
    /Ran? (?:command )?[`"]?([^`"\n]+)[`"]?/i,
    /Commit(?:ted|ting)? [`"]?([^`"\n]+)[`"]?/i,
    /Deploy(?:ed|ing)? (?:to )?([^`"\n]+)/i,
    /Test(?:ed|ing)? ([^`"\n]+)/i,
    /TASK_COMPLETE/i,
    /TASK_BLOCKED/i,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      return match[0].slice(0, 100); // Truncate
    }
  }

  // Return first non-empty line if no pattern matched
  const lines = output.trim().split('\n').filter(l => l.trim());
  if (lines.length > 0) {
    return lines[0].slice(0, 100);
  }

  return null;
}
