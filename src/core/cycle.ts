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
 * Load environment variables from .nexus/.env
 */
function loadEnvFile(): Record<string, string> {
  const envPath = join(homedir(), '.nexus', '.env');
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
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch('http://127.0.0.1:37777/health', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      console.log(`[Cycle] HutchMem worker healthy ✓`);
      return true;
    }
    console.log(`[Cycle] HutchMem worker returned ${response.status}`);
    return false;
  } catch (err: any) {
    console.log(`[Cycle] HutchMem worker not reachable: ${err.message}`);
    return false;
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

  // Pre-cycle health check
  const hutchMemHealthy = await checkHutchMemHealth();
  if (!hutchMemHealthy) {
    console.log(`[Cycle] ⚠️ HutchMem worker not healthy, proceeding anyway`);
  }

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
 * Run Claude Code CLI with a prompt
 * Includes stuck detection and retry logic
 */
async function runClaudeCode(
  prompt: string,
  options: {
    cwd?: string;
    maxTurns?: number;
    attempt?: number;
  }
): Promise<{ success: boolean; output: string; error?: string }> {
  const MAX_RETRIES = 3;
  const NO_OUTPUT_TIMEOUT = 4 * 60 * 1000;  // 4 minutes with no output = stuck (Claude buffers output)
  const MAX_CYCLE_TIME = 8 * 60 * 1000;  // 8 minutes max per cycle
  const attempt = options.attempt || 1;

  return new Promise((resolve) => {
    // Ensure working directory exists
    const cwd = options.cwd || process.cwd();
    mkdirSync(cwd, { recursive: true });

    const args = [
      '--print',  // Non-interactive mode
      '--dangerously-skip-permissions',  // Auto-approve
      '--model', 'sonnet',  // Use Sonnet for speed/cost
      '--max-turns', '50',  // Limit turns
      prompt,
    ];

    console.log(`[Cycle] Running claude in ${cwd} (attempt ${attempt}/${MAX_RETRIES})`);
    console.log(`[Cycle] Prompt length: ${prompt.length} chars`);

    const claude = spawn('claude', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,  // Don't use shell to avoid escaping issues
      env: {
        ...process.env,
        // Load Colosseum credentials if available
        ...loadEnvFile(),
      },
    });

    // Close stdin immediately to signal no more input
    claude.stdin.end();

    let stdout = '';
    let stderr = '';
    let lastActivityTime = Date.now();
    let lastLogTime = Date.now();
    let lineBuffer = '';
    let resolved = false;
    let stuckCheckInterval: NodeJS.Timeout;
    let maxTimeoutId: NodeJS.Timeout;

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

    // Stream stdout in real-time
    claude.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      lineBuffer += chunk;
      lastActivityTime = Date.now();  // Update activity timestamp

      // Log complete lines
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          // Detect tool usage patterns
          if (line.includes('Read') || line.includes('Write') || line.includes('Edit')) {
            console.log(`[Claude] 📄 ${line.slice(0, 150)}`);
          } else if (line.includes('Bash') || line.includes('running')) {
            console.log(`[Claude] 💻 ${line.slice(0, 150)}`);
          } else if (line.includes('TASK_COMPLETE')) {
            console.log(`[Claude] ✅ Task marked complete`);
          } else if (line.includes('TASK_BLOCKED')) {
            console.log(`[Claude] 🚫 Task blocked: ${line.slice(0, 100)}`);
          } else if (line.includes('error') || line.includes('Error')) {
            console.log(`[Claude] ⚠️ ${line.slice(0, 150)}`);
          } else {
            // Log periodic updates
            const now = Date.now();
            if (now - lastLogTime > 5000) { // Every 5 seconds
              console.log(`[Claude] ${line.slice(0, 150)}`);
              lastLogTime = now;
            }
          }
        }
      }
    });

    claude.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      lastActivityTime = Date.now();  // stderr is also activity
      // Log errors immediately
      if (chunk.trim()) {
        console.log(`[Claude:err] ${chunk.trim().slice(0, 200)}`);
      }
    });

    claude.on('close', (code) => {
      // Log any remaining buffer
      if (lineBuffer.trim()) {
        console.log(`[Claude] ${lineBuffer.slice(0, 150)}`);
      }
      console.log(`[Cycle] Claude exited with code ${code}`);

      handleResolve({
        success: code === 0,
        output: stdout,
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

    // Stuck detection: check every 15 seconds if no output for 90 seconds
    stuckCheckInterval = setInterval(() => {
      const timeSinceActivity = Date.now() - lastActivityTime;
      const totalTime = Date.now() - (lastActivityTime - timeSinceActivity);

      if (timeSinceActivity > NO_OUTPUT_TIMEOUT) {
        console.log(`[Cycle] ⚠️ STUCK DETECTED: No output for ${Math.floor(timeSinceActivity / 1000)}s`);
        console.log(`[Cycle] Current output: ${stdout.length} chars`);

        // Kill the stuck process
        claude.kill('SIGTERM');

        // Retry if we haven't exceeded max retries
        if (attempt < MAX_RETRIES) {
          console.log(`[Cycle] 🔄 Retrying... (attempt ${attempt + 1}/${MAX_RETRIES})`);
          cleanup();

          // Small delay before retry
          setTimeout(() => {
            runClaudeCode(prompt, { ...options, attempt: attempt + 1 })
              .then(handleResolve);
          }, 2000);
        } else {
          console.log(`[Cycle] ❌ Max retries exceeded, giving up`);
          handleResolve({
            success: false,
            output: stdout,
            error: `Stuck after ${MAX_RETRIES} attempts (no output for ${NO_OUTPUT_TIMEOUT / 1000}s)`,
          });
        }
      } else {
        // Progress indicator
        console.log(`[Cycle] ⏳ Working... (${stdout.length} chars, last activity ${Math.floor(timeSinceActivity / 1000)}s ago)`);
      }
    }, 15000);

    // Hard timeout after 5 minutes
    maxTimeoutId = setTimeout(() => {
      if (!resolved) {
        console.log(`[Cycle] ⏰ Max cycle time (${MAX_CYCLE_TIME / 1000}s) reached`);
        claude.kill('SIGTERM');
        handleResolve({
          success: false,
          output: stdout,
          error: `Cycle timeout (${MAX_CYCLE_TIME / 1000}s)`,
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
