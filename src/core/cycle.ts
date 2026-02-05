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
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Goal, Task, Scheduler } from '../scheduler/scheduler.js';
import { getSystemPrompt } from '../prompts/system.js';

/**
 * Load environment variables from .hutch-agent/.env
 */
function loadEnvFile(): Record<string, string> {
  const envPath = join(homedir(), '.hutch-agent', '.env');
  const env: Record<string, string> = {};

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          env[key] = valueParts.join('=');
        }
      }
    }
  }

  return env;
}

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
 * Check if HutchMem worker is healthy
 */
async function checkHutchMemHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch('http://127.0.0.1:37777/health', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json().catch(() => ({})) as { uptime?: string };
      console.log(`[Cycle] ✓ HutchMem healthy (uptime: ${data.uptime || 'unknown'})`);
      return true;
    }
    console.log(`[Cycle] ⚠️ HutchMem returned ${response.status}`);
    return false;
  } catch (err: any) {
    // Not critical - agent can work without memory
    console.log(`[Cycle] ⚠️ HutchMem not available (${err.message?.slice(0, 50) || 'timeout'})`);
    return false;
  }
}

/**
 * Ensure HutchMem plugin symlinks exist
 */
function ensureHutchMemSymlinks(): void {
  const pluginDir = join(homedir(), '.claude', 'plugins', 'marketplaces', 'thedotmack');
  const sourceDir = join(homedir(), 'hutch-mem');

  if (!existsSync(pluginDir)) {
    console.log(`[Cycle] Creating HutchMem plugin symlink directory: ${pluginDir}`);
    try {
      mkdirSync(pluginDir, { recursive: true });
      // The actual symlinks should be created during setup
      console.log(`[Cycle] ⚠️ HutchMem plugin directory created but symlinks may need manual setup`);
    } catch (err: any) {
      console.log(`[Cycle] ⚠️ Could not create plugin directory: ${err.message}`);
    }
  }
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

  // Ensure plugin symlinks exist (one-time setup)
  ensureHutchMemSymlinks();

  // Pre-cycle health check (non-blocking)
  const hutchMemHealthy = await checkHutchMemHealth();

  // Use custom prompt from planner if provided, otherwise build default
  const prompt = customPrompt || buildCyclePrompt(goal, task, state);

  try {
    console.log(`[Cycle] Starting task: ${task?.name || 'no specific task'}`);
    const startTime = Date.now();

    // Run claude code with the prompt
    const result = await runClaudeCode(prompt, {
      cwd: goal.workingDirectory || process.cwd(),
      maxTurns: 50,
    });

    const duration = Math.floor((Date.now() - startTime) / 1000);
    console.log(`[Cycle] Completed in ${duration}s with ${result.success ? 'success' : 'failure'}`);

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
    console.log(`[Cycle] Exception: ${err.message}`);
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
 * Run Claude Code CLI with a prompt using streaming JSON output
 *
 * Uses --output-format stream-json for real-time visibility into what
 * Claude is doing (tool calls, results, etc.)
 */
async function runClaudeCode(
  prompt: string,
  options: {
    cwd?: string;
    maxTurns?: number;
  }
): Promise<{ success: boolean; output: string; error?: string }> {
  // 15 minutes max - some tasks take time
  const MAX_CYCLE_TIME = 15 * 60 * 1000;
  // No activity for 2 minutes = stuck
  const STUCK_TIMEOUT = 2 * 60 * 1000;

  return new Promise((resolve) => {
    const cwd = options.cwd || process.cwd();
    mkdirSync(cwd, { recursive: true });

    const args = [
      '--print',
      '--verbose',                       // Required for stream-json
      '--output-format', 'stream-json',  // Real-time streaming JSON
      '--include-partial-messages',      // See partial messages as they arrive
      '--dangerously-skip-permissions',
      '--model', 'sonnet',
      '--max-turns', String(options.maxTurns || 50),
      prompt,
    ];

    const startTime = Date.now();
    let lastActivityTime = Date.now();
    console.log(`[Cycle] Running claude in ${cwd}`);
    console.log(`[Cycle] Prompt: ${prompt.slice(0, 200)}...`);

    const claude = spawn('claude', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: {
        ...process.env,
        ...loadEnvFile(),
      },
    });

    claude.stdin.end();

    let stdout = '';
    let stderr = '';
    let lineBuffer = '';
    let resolved = false;
    let stuckCheckInterval: NodeJS.Timeout;
    let maxTimeoutId: NodeJS.Timeout;
    let lastTool = '';
    let toolCount = 0;
    let resultText = '';  // Accumulate result text

    const cleanup = () => {
      if (stuckCheckInterval) clearInterval(stuckCheckInterval);
      if (maxTimeoutId) clearTimeout(maxTimeoutId);
    };

    const handleResolve = (result: { success: boolean; output: string; error?: string }) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    // Parse streaming JSON output for real-time visibility
    claude.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      lineBuffer += chunk;
      lastActivityTime = Date.now();

      // Process complete JSON lines (newline-delimited JSON)
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line);
          const elapsed = Math.floor((Date.now() - startTime) / 1000);

          // Handle different event types based on Claude CLI stream-json format
          switch (event.type) {
            case 'system':
              // System events: init, hook_response
              if (event.subtype === 'init') {
                console.log(`[Claude ${elapsed}s] 📋 Session started: ${event.session_id?.slice(0, 8)} | Model: ${event.model}`);
              } else if (event.subtype === 'hook_response') {
                // Hook fired - check for errors
                if (event.stderr && event.exit_code !== 0) {
                  console.log(`[Claude ${elapsed}s] ⚠️ Hook error: ${event.hook_name}`);
                }
              }
              break;

            case 'stream_event':
              // Real-time streaming events
              const streamType = event.event?.type;
              if (streamType === 'content_block_start') {
                const block = event.event.content_block;
                if (block?.type === 'tool_use') {
                  toolCount++;
                  lastTool = block.name;
                  console.log(`[Claude ${elapsed}s] 🔧 Tool #${toolCount}: ${lastTool}`);
                }
              } else if (streamType === 'content_block_delta') {
                const delta = event.event.delta;
                if (delta?.type === 'text_delta' && delta.text) {
                  resultText += delta.text;
                  // Log significant text chunks
                  const text = delta.text.trim();
                  if (text.includes('TASK_COMPLETE')) {
                    console.log(`[Claude ${elapsed}s] ✅ TASK_COMPLETE detected`);
                  } else if (text.includes('TASK_BLOCKED')) {
                    console.log(`[Claude ${elapsed}s] 🚫 TASK_BLOCKED detected`);
                  }
                } else if (delta?.type === 'input_json_delta') {
                  // Tool input being streamed - activity indicator
                }
              } else if (streamType === 'message_start') {
                // New message starting
              }
              break;

            case 'assistant':
              // Complete assistant message with tool uses
              if (event.message?.content) {
                for (const block of event.message.content) {
                  if (block.type === 'text' && block.text) {
                    // Don't double-add - this is the complete message
                    const text = block.text.trim();
                    if (text.length > 50) {
                      console.log(`[Claude ${elapsed}s] 💬 ${text.slice(0, 150)}...`);
                    }
                  } else if (block.type === 'tool_use') {
                    // Tool was used
                    const inputStr = JSON.stringify(block.input || {}).slice(0, 80);
                    console.log(`[Claude ${elapsed}s] 🔧 ${block.name}: ${inputStr}`);
                  }
                }
              }
              break;

            case 'user':
              // Tool results coming back
              if (event.message?.content) {
                for (const block of event.message.content) {
                  if (block.type === 'tool_result') {
                    const success = !block.is_error;
                    const preview = (block.content || '').toString().slice(0, 60);
                    console.log(`[Claude ${elapsed}s] ${success ? '✓' : '✗'} Result: ${preview}...`);
                  }
                }
              }
              break;

            case 'result':
              // Final result
              const status = event.subtype === 'success' ? '✅' : '❌';
              console.log(`[Claude ${elapsed}s] ${status} Done: ${event.subtype} (${event.num_turns} turns, ${event.duration_ms}ms)`);
              if (event.result) {
                resultText = event.result;
              }
              break;

            case 'error':
              console.log(`[Claude ${elapsed}s] ❌ Error: ${event.error?.message || JSON.stringify(event).slice(0, 100)}`);
              break;
          }
        } catch (e) {
          // Not valid JSON - might be raw output
          if (line.trim().length > 20) {
            console.log(`[Claude] Raw: ${line.slice(0, 100)}`);
          }
        }
      }
    });

    claude.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      lastActivityTime = Date.now();
      if (chunk.trim()) {
        console.log(`[Claude:err] ${chunk.trim().slice(0, 200)}`);
      }
    });

    claude.on('close', (code) => {
      const duration = Math.floor((Date.now() - startTime) / 1000);
      console.log(`[Cycle] Claude exited with code ${code} after ${duration}s (${toolCount} tools used)`);

      handleResolve({
        success: code === 0,
        output: resultText || stdout,
        error: code !== 0 ? stderr || `Exit code: ${code}` : undefined,
      });
    });

    claude.on('error', (err) => {
      console.log(`[Cycle] Claude spawn error: ${err.message}`);
      handleResolve({
        success: false,
        output: '',
        error: err.message,
      });
    });

    // Stuck detection: no activity for 2 minutes
    stuckCheckInterval = setInterval(() => {
      const timeSinceActivity = Date.now() - lastActivityTime;
      const elapsed = Math.floor((Date.now() - startTime) / 1000);

      if (timeSinceActivity > STUCK_TIMEOUT) {
        console.log(`[Cycle] ⚠️ STUCK: No activity for ${Math.floor(timeSinceActivity / 1000)}s`);
        console.log(`[Cycle] Last tool: ${lastTool || 'none'}, Tools used: ${toolCount}`);
        claude.kill('SIGTERM');
        handleResolve({
          success: false,
          output: resultText || stdout,
          error: `Stuck - no activity for ${STUCK_TIMEOUT / 1000}s`,
        });
      } else {
        console.log(`[Cycle] ⏳ ${elapsed}s | Tools: ${toolCount} | Last: ${lastTool || 'starting'}`);
      }
    }, 30000);

    // Hard timeout
    maxTimeoutId = setTimeout(() => {
      if (!resolved) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        console.log(`[Cycle] ⏰ Timeout after ${elapsed}s`);
        claude.kill('SIGTERM');
        handleResolve({
          success: false,
          output: resultText || stdout,
          error: `Timeout (${MAX_CYCLE_TIME / 1000}s)`,
        });
      }
    }, MAX_CYCLE_TIME);
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
