/**
 * NEXUS Termination Tools
 *
 * Explicit tools for signaling task completion, blocking, skipping, or help requests.
 * Replaces text-based detection (like "TASK_COMPLETE") with required tool calls.
 *
 * Benefits:
 * - Structured data instead of text parsing
 * - Clear artifacts and blockers tracking
 * - Unambiguous task state transitions
 * - Better observability and logging
 */

/**
 * Artifact produced by task completion
 */
export interface TaskArtifact {
  /** Type of artifact */
  type: 'file' | 'commit' | 'deployment' | 'test_result' | 'documentation' | 'other';
  /** Path or identifier */
  path: string;
  /** Description of what was created/modified */
  description?: string;
}

/**
 * Blocker preventing task completion
 */
export interface TaskBlocker {
  /** Type of blocker */
  type: 'missing_info' | 'missing_access' | 'dependency' | 'error' | 'unclear_requirements' | 'other';
  /** Description of the blocker */
  description: string;
  /** What's needed to unblock */
  resolution?: string;
}

/**
 * Result from calling complete_task tool
 */
export interface CompleteTaskResult {
  type: 'complete';
  taskId: string;
  summary: string;
  artifacts: TaskArtifact[];
  timestamp: string;
}

/**
 * Result from calling block_task tool
 */
export interface BlockTaskResult {
  type: 'blocked';
  taskId: string;
  reason: string;
  blockers: TaskBlocker[];
  timestamp: string;
}

/**
 * Result from calling skip_task tool
 */
export interface SkipTaskResult {
  type: 'skipped';
  taskId: string;
  reason: string;
  timestamp: string;
}

/**
 * Result from calling request_help tool
 */
export interface RequestHelpResult {
  type: 'help_requested';
  taskId: string;
  question: string;
  context?: string;
  timestamp: string;
}

/**
 * Union type for all termination results
 */
export type TerminationResult =
  | CompleteTaskResult
  | BlockTaskResult
  | SkipTaskResult
  | RequestHelpResult;

/**
 * Tool definitions for Claude Code tool_use format
 * These are provided to the LLM as available tools
 */
export const TERMINATION_TOOL_DEFINITIONS = [
  {
    name: 'complete_task',
    description: 'Signal that the current task has been completed successfully. You MUST call this tool when you have finished the task. Do not just say "TASK_COMPLETE" - you must use this tool.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The ID of the task being completed',
        },
        summary: {
          type: 'string',
          description: 'Brief summary of what was accomplished (2-3 sentences)',
        },
        artifacts: {
          type: 'array',
          description: 'Files, commits, or other outputs created',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['file', 'commit', 'deployment', 'test_result', 'documentation', 'other'],
              },
              path: {
                type: 'string',
                description: 'Path or identifier of the artifact',
              },
              description: {
                type: 'string',
                description: 'What this artifact is or does',
              },
            },
            required: ['type', 'path'],
          },
        },
      },
      required: ['task_id', 'summary'],
    },
  },
  {
    name: 'block_task',
    description: 'Signal that the task cannot be completed due to blockers. Use this when you encounter issues that prevent progress and need external intervention.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The ID of the blocked task',
        },
        reason: {
          type: 'string',
          description: 'Brief explanation of why the task is blocked',
        },
        blockers: {
          type: 'array',
          description: 'Specific blockers preventing completion',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['missing_info', 'missing_access', 'dependency', 'error', 'unclear_requirements', 'other'],
              },
              description: {
                type: 'string',
                description: 'What the blocker is',
              },
              resolution: {
                type: 'string',
                description: 'What would unblock this',
              },
            },
            required: ['type', 'description'],
          },
        },
      },
      required: ['task_id', 'reason'],
    },
  },
  {
    name: 'skip_task',
    description: 'Signal that a task should be skipped. Use this when a task is no longer relevant, already done, or should be deferred.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The ID of the task to skip',
        },
        reason: {
          type: 'string',
          description: 'Why this task should be skipped',
        },
      },
      required: ['task_id', 'reason'],
    },
  },
  {
    name: 'request_help',
    description: 'Request human assistance or clarification. Use this when you need input before proceeding.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The ID of the task needing help',
        },
        question: {
          type: 'string',
          description: 'The specific question or help needed',
        },
        context: {
          type: 'string',
          description: 'Additional context about what you tried or discovered',
        },
      },
      required: ['task_id', 'question'],
    },
  },
];

/**
 * Handler for termination tool calls
 * Parses and validates the tool input, returns structured result
 */
export class TerminationHandler {
  private pendingResult: TerminationResult | null = null;

  /**
   * Check if a tool name is a termination tool
   */
  isTerminationTool(toolName: string): boolean {
    return ['complete_task', 'block_task', 'skip_task', 'request_help'].includes(toolName);
  }

  /**
   * Handle a termination tool call
   * Returns a result that should be used to update task state
   */
  handleToolCall(
    toolName: string,
    input: Record<string, unknown>
  ): TerminationResult | null {
    const timestamp = new Date().toISOString();

    switch (toolName) {
      case 'complete_task':
        this.pendingResult = {
          type: 'complete',
          taskId: String(input.task_id || ''),
          summary: String(input.summary || ''),
          artifacts: this.parseArtifacts(input.artifacts),
          timestamp,
        };
        return this.pendingResult;

      case 'block_task':
        this.pendingResult = {
          type: 'blocked',
          taskId: String(input.task_id || ''),
          reason: String(input.reason || ''),
          blockers: this.parseBlockers(input.blockers),
          timestamp,
        };
        return this.pendingResult;

      case 'skip_task':
        this.pendingResult = {
          type: 'skipped',
          taskId: String(input.task_id || ''),
          reason: String(input.reason || ''),
          timestamp,
        };
        return this.pendingResult;

      case 'request_help':
        this.pendingResult = {
          type: 'help_requested',
          taskId: String(input.task_id || ''),
          question: String(input.question || ''),
          context: input.context ? String(input.context) : undefined,
          timestamp,
        };
        return this.pendingResult;

      default:
        return null;
    }
  }

  /**
   * Get the pending result (if any)
   */
  getPendingResult(): TerminationResult | null {
    return this.pendingResult;
  }

  /**
   * Clear the pending result
   */
  clearPendingResult(): void {
    this.pendingResult = null;
  }

  /**
   * Check if cycle should terminate based on tool call
   */
  shouldTerminate(): boolean {
    return this.pendingResult !== null;
  }

  /**
   * Generate tool result response for the LLM
   */
  generateToolResponse(result: TerminationResult): string {
    switch (result.type) {
      case 'complete':
        return `Task ${result.taskId} marked as complete. Summary recorded. You may now proceed to the next task or end the cycle.`;
      case 'blocked':
        return `Task ${result.taskId} marked as blocked. ${result.blockers.length} blocker(s) recorded. The orchestrator will handle escalation.`;
      case 'skipped':
        return `Task ${result.taskId} marked as skipped. Reason recorded. Proceeding to next task.`;
      case 'help_requested':
        return `Help request for task ${result.taskId} recorded. Awaiting human response.`;
    }
  }

  private parseArtifacts(input: unknown): TaskArtifact[] {
    if (!Array.isArray(input)) return [];
    return input
      .filter((item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null)
      .map(item => ({
        type: this.validateArtifactType(String(item.type || 'other')),
        path: String(item.path || ''),
        description: item.description ? String(item.description) : undefined,
      }));
  }

  private parseBlockers(input: unknown): TaskBlocker[] {
    if (!Array.isArray(input)) return [];
    return input
      .filter((item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null)
      .map(item => ({
        type: this.validateBlockerType(String(item.type || 'other')),
        description: String(item.description || ''),
        resolution: item.resolution ? String(item.resolution) : undefined,
      }));
  }

  private validateArtifactType(type: string): TaskArtifact['type'] {
    const valid: TaskArtifact['type'][] = ['file', 'commit', 'deployment', 'test_result', 'documentation', 'other'];
    return valid.includes(type as TaskArtifact['type']) ? type as TaskArtifact['type'] : 'other';
  }

  private validateBlockerType(type: string): TaskBlocker['type'] {
    const valid: TaskBlocker['type'][] = ['missing_info', 'missing_access', 'dependency', 'error', 'unclear_requirements', 'other'];
    return valid.includes(type as TaskBlocker['type']) ? type as TaskBlocker['type'] : 'other';
  }
}

/**
 * Generate system prompt instructions for termination tools
 */
export function getTerminationInstructions(): string {
  return `
## Task Termination

When you finish working on a task, you MUST use one of these termination tools:

1. **complete_task** - Task completed successfully
   - Call when you've finished all the work
   - Include a summary and list of artifacts created
   - Example: Created file, made commit, deployed, etc.

2. **block_task** - Cannot proceed due to blockers
   - Call when something prevents completion
   - Specify the blocker type and what would resolve it
   - Example: Missing credentials, dependency unavailable, etc.

3. **skip_task** - Task should be skipped
   - Call when task is no longer relevant or already done
   - Explain why it should be skipped

4. **request_help** - Need human assistance
   - Call when you need clarification or input
   - Be specific about what you need to know

IMPORTANT: Do NOT just write "TASK_COMPLETE" or similar text. You MUST call one of these tools to properly signal task state. The orchestrator relies on these tool calls to manage task flow.
`;
}

/**
 * Parse output text for legacy TASK_COMPLETE/TASK_BLOCKED patterns
 * Used during migration period for backwards compatibility
 */
export function detectLegacyTermination(output: string): {
  detected: boolean;
  type: 'complete' | 'blocked' | null;
  text: string | null;
} {
  const completeMatch = output.match(/TASK_COMPLETE[:\s]*(.+)?/i);
  if (completeMatch) {
    return {
      detected: true,
      type: 'complete',
      text: completeMatch[1]?.trim() || null,
    };
  }

  const blockedMatch = output.match(/TASK_BLOCKED[:\s]*(.+)?/i);
  if (blockedMatch) {
    return {
      detected: true,
      type: 'blocked',
      text: blockedMatch[1]?.trim() || null,
    };
  }

  return { detected: false, type: null, text: null };
}
