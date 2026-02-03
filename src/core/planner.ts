/**
 * NEXUS Planner
 *
 * The agent's brain - analyzes goals, queries memory, and creates action plans.
 * Before each action, the planner:
 * 1. Analyzes the current goal and task
 * 2. Queries HutchMem for relevant past experience
 * 3. Considers what approaches worked before
 * 4. Creates a concrete action plan
 */

import { spawn } from 'child_process';
import { Goal, Task } from '../scheduler/scheduler.js';
import { HealthMetrics } from './heartbeat.js';

export interface Plan {
  // What to do
  task: Task;
  approach: string;
  steps: string[];

  // Context from memory
  relevantMemory: string[];
  pastSuccesses: string[];
  pastFailures: string[];

  // Strategy
  estimatedComplexity: 'simple' | 'medium' | 'complex';
  riskLevel: 'low' | 'medium' | 'high';
  fallbackApproach?: string;

  // Prompt for Claude
  prompt: string;
}

export interface PlannerContext {
  goal: Goal;
  task: Task | null;
  metrics: HealthMetrics;
  recentActions: Array<{
    action: string;
    outcome: 'success' | 'failure';
  }>;
}

export class Planner {
  /**
   * Create a plan for the current task
   */
  async createPlan(context: PlannerContext): Promise<Plan> {
    const { goal, task, metrics, recentActions } = context;

    if (!task) {
      // No specific task - need to figure out what to do
      return this.createExploratoryPlan(goal, metrics);
    }

    // Query memory for relevant experience
    const memory = await this.queryMemory(task.name, goal.name);

    // Analyze past attempts at similar tasks
    const analysis = this.analyzeHistory(recentActions, memory);

    // Determine approach
    const approach = this.selectApproach(task, analysis, metrics);

    // Create step-by-step plan
    const steps = this.generateSteps(task, approach);

    // Estimate complexity and risk
    const complexity = this.estimateComplexity(task, steps);
    const risk = this.assessRisk(task, analysis, metrics);

    // Build the prompt for Claude
    const prompt = this.buildPrompt(goal, task, approach, steps, memory, metrics);

    return {
      task,
      approach,
      steps,
      relevantMemory: memory.relevant,
      pastSuccesses: memory.successes,
      pastFailures: memory.failures,
      estimatedComplexity: complexity,
      riskLevel: risk,
      fallbackApproach: analysis.alternativeApproach,
      prompt,
    };
  }

  /**
   * Query HutchMem for relevant experience
   */
  private async queryMemory(taskName: string, goalName: string): Promise<{
    relevant: string[];
    successes: string[];
    failures: string[];
  }> {
    try {
      // Query the HutchMem API
      const response = await fetch(`http://localhost:37777/api/search?q=${encodeURIComponent(taskName)}&limit=10`);

      if (!response.ok) {
        return { relevant: [], successes: [], failures: [] };
      }

      const results = await response.json() as {
        observations?: Array<{ type: string; title: string; narrative?: string }>;
      };

      // Parse results into categories
      const relevant: string[] = [];
      const successes: string[] = [];
      const failures: string[] = [];

      for (const obs of results.observations || []) {
        const summary = `${obs.title}: ${obs.narrative || ''}`.slice(0, 200);
        relevant.push(summary);

        if (obs.type === 'feature' || obs.type === 'change') {
          successes.push(summary);
        } else if (obs.type === 'bugfix') {
          failures.push(summary);
        }
      }

      return { relevant, successes, failures };

    } catch (err) {
      // HutchMem not available - continue without memory
      return { relevant: [], successes: [], failures: [] };
    }
  }

  /**
   * Analyze recent history and memory
   */
  private analyzeHistory(
    recentActions: Array<{ action: string; outcome: string }>,
    memory: { relevant: string[]; successes: string[]; failures: string[] }
  ): {
    recentSuccessRate: number;
    commonFailures: string[];
    alternativeApproach?: string;
  } {
    const recent = recentActions.slice(-10);
    const successes = recent.filter(a => a.outcome === 'success').length;
    const recentSuccessRate = recent.length > 0 ? successes / recent.length : 1;

    // Find common failure patterns
    const failureActions = recent.filter(a => a.outcome === 'failure').map(a => a.action);
    const commonFailures = [...new Set(failureActions)];

    // Suggest alternative if failing repeatedly
    let alternativeApproach: string | undefined;
    if (recentSuccessRate < 0.3 && recent.length >= 3) {
      alternativeApproach = 'Try a different approach: break into smaller steps, search for examples, or skip to next task';
    }

    return {
      recentSuccessRate,
      commonFailures,
      alternativeApproach,
    };
  }

  /**
   * Select the best approach for the task
   */
  private selectApproach(
    task: Task,
    analysis: { recentSuccessRate: number; commonFailures: string[] },
    metrics: HealthMetrics
  ): string {
    const taskLower = task.name.toLowerCase();

    // Urgency-based approaches
    if (metrics.urgencyLevel === 'critical') {
      return 'quick-and-dirty: Focus on getting it working, polish later';
    }

    // Task-type based approaches
    if (taskLower.includes('test')) {
      return 'test-driven: Write tests first, then implement';
    }

    if (taskLower.includes('fix') || taskLower.includes('bug')) {
      return 'debug-first: Understand the problem before fixing';
    }

    if (taskLower.includes('implement') || taskLower.includes('create') || taskLower.includes('add')) {
      return 'iterative: Start simple, add complexity incrementally';
    }

    if (taskLower.includes('deploy')) {
      return 'cautious: Verify each step before proceeding';
    }

    if (taskLower.includes('design') || taskLower.includes('plan')) {
      return 'research-first: Look at existing patterns before designing';
    }

    // Failure-adjusted approach
    if (analysis.recentSuccessRate < 0.5) {
      return 'step-by-step: Break into tiny steps, verify each one';
    }

    // Default
    return 'standard: Analyze, implement, test, commit';
  }

  /**
   * Generate step-by-step plan
   */
  private generateSteps(task: Task, approach: string): string[] {
    const taskLower = task.name.toLowerCase();

    // Common step patterns
    const steps: string[] = [];

    // Research/understand step
    if (!approach.includes('quick')) {
      steps.push('Understand the current state and requirements');
    }

    // Implementation steps based on task type
    if (taskLower.includes('implement') || taskLower.includes('create') || taskLower.includes('add')) {
      steps.push('Create the necessary files and structure');
      steps.push('Implement the core functionality');
      steps.push('Add error handling');
      steps.push('Test the implementation');
    } else if (taskLower.includes('test')) {
      steps.push('Identify what needs to be tested');
      steps.push('Write test cases');
      steps.push('Run tests and verify');
    } else if (taskLower.includes('deploy')) {
      steps.push('Build the project');
      steps.push('Verify build output');
      steps.push('Deploy to target environment');
      steps.push('Verify deployment');
    } else if (taskLower.includes('fix') || taskLower.includes('bug')) {
      steps.push('Reproduce the issue');
      steps.push('Identify the root cause');
      steps.push('Implement the fix');
      steps.push('Verify the fix');
    } else {
      steps.push('Execute the task');
      steps.push('Verify the result');
    }

    // Commit step
    steps.push('Commit changes with descriptive message');

    return steps;
  }

  /**
   * Estimate task complexity
   */
  private estimateComplexity(task: Task, steps: string[]): 'simple' | 'medium' | 'complex' {
    const taskLower = task.name.toLowerCase();

    // Complex keywords
    if (taskLower.includes('architecture') || taskLower.includes('refactor') || taskLower.includes('redesign')) {
      return 'complex';
    }

    // Simple keywords
    if (taskLower.includes('update') || taskLower.includes('fix typo') || taskLower.includes('rename')) {
      return 'simple';
    }

    // Step count based
    if (steps.length <= 3) return 'simple';
    if (steps.length >= 6) return 'complex';

    return 'medium';
  }

  /**
   * Assess risk level
   */
  private assessRisk(
    task: Task,
    analysis: { recentSuccessRate: number },
    metrics: HealthMetrics
  ): 'low' | 'medium' | 'high' {
    const taskLower = task.name.toLowerCase();

    // High risk tasks
    if (taskLower.includes('deploy') || taskLower.includes('production') || taskLower.includes('mainnet')) {
      return 'high';
    }

    // Risk from repeated failures
    if (analysis.recentSuccessRate < 0.3) {
      return 'high';
    }

    if (metrics.consecutiveFailures >= 2) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Build the prompt for Claude
   */
  private buildPrompt(
    goal: Goal,
    task: Task,
    approach: string,
    steps: string[],
    memory: { relevant: string[]; successes: string[]; failures: string[] },
    metrics: HealthMetrics
  ): string {
    let prompt = `## Current Goal
${goal.name}

## Current Task
${task.name}
${task.description || ''}

## Approach
${approach}

## Steps to Follow
${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
`;

    // Add memory context if available
    if (memory.relevant.length > 0) {
      prompt += `\n## Relevant Past Experience
${memory.relevant.slice(0, 5).map(m => `- ${m}`).join('\n')}
`;
    }

    if (memory.failures.length > 0) {
      prompt += `\n## Past Failures to Avoid
${memory.failures.slice(0, 3).map(f => `- ${f}`).join('\n')}
`;
    }

    // Add urgency context
    if (metrics.urgencyLevel === 'critical' || metrics.urgencyLevel === 'high') {
      prompt += `\n## URGENCY
${metrics.deadlineHours !== null ? `Only ${metrics.deadlineHours} hours until deadline!` : 'High priority - work efficiently'}
Focus on getting it done, don't over-engineer.
`;
    }

    // Add instructions
    prompt += `\n## Instructions
1. Follow the approach and steps above
2. Use tools to make progress (Write, Edit, Bash, etc.)
3. Test your changes when applicable
4. When done, say "TASK_COMPLETE"
5. If blocked, say "TASK_BLOCKED: [reason]"

Begin working on the task.`;

    return prompt;
  }

  /**
   * Create an exploratory plan when no specific task is defined
   */
  private createExploratoryPlan(goal: Goal, metrics: HealthMetrics): Plan {
    return {
      task: {
        id: 'explore',
        name: 'Analyze and plan next steps',
        status: 'in_progress',
      },
      approach: 'exploratory: Understand the goal and determine next actions',
      steps: [
        'Review the current goal and progress',
        'Identify what has been done',
        'Determine the most important next step',
        'Create a plan for that step',
      ],
      relevantMemory: [],
      pastSuccesses: [],
      pastFailures: [],
      estimatedComplexity: 'simple',
      riskLevel: 'low',
      prompt: `## Goal
${goal.name}

## Situation
No specific task is assigned. Analyze the goal and determine the next action.

## Instructions
1. Review the goal and any existing progress
2. Identify the highest priority next step
3. Begin working on that step
4. When you've made progress, say "TASK_COMPLETE: [what you did]"
`,
    };
  }
}
