/**
 * Hutch Agent Productivity Capabilities
 *
 * This module provides structured helpers for common productivity tasks.
 * Each capability is designed to genuinely help humans work more effectively.
 */

// ============================================================
// Types & Interfaces
// ============================================================

export interface TaskBreakdown {
  originalTask: string;
  subtasks: SubTask[];
  estimatedTotalEffort: 'trivial' | 'small' | 'medium' | 'large' | 'complex';
  suggestedApproach: string;
  potentialBlockers: string[];
  successCriteria: string[];
}

export interface SubTask {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
  effort: 'trivial' | 'small' | 'medium' | 'large';
  type: 'research' | 'implement' | 'review' | 'test' | 'document' | 'communicate' | 'decide';
}

export interface ResearchResult {
  query: string;
  summary: string;
  keyFindings: string[];
  sources: string[];
  confidence: 'high' | 'medium' | 'low';
  gaps: string[];
  nextSteps: string[];
}

export interface Decision {
  question: string;
  options: DecisionOption[];
  criteria: string[];
  recommendation?: string;
  reasoning?: string;
}

export interface DecisionOption {
  name: string;
  description: string;
  pros: string[];
  cons: string[];
  risks: string[];
  score?: number;
}

export interface WorkSession {
  startTime: Date;
  endTime?: Date;
  goal: string;
  tasksCompleted: string[];
  tasksBlocked: string[];
  insights: string[];
  nextSteps: string[];
}

export interface DailySummary {
  date: string;
  totalTasksCompleted: number;
  totalTasksBlocked: number;
  keyAccomplishments: string[];
  lessonsLearned: string[];
  tomorrowPriorities: string[];
}

// ============================================================
// ProductivityHelper - General productivity assistance
// ============================================================

export class ProductivityHelper {
  private workSessions: WorkSession[] = [];
  private currentSession: WorkSession | null = null;

  /**
   * Start a focused work session
   */
  startSession(goal: string): WorkSession {
    this.currentSession = {
      startTime: new Date(),
      goal,
      tasksCompleted: [],
      tasksBlocked: [],
      insights: [],
      nextSteps: [],
    };
    return this.currentSession;
  }

  /**
   * End the current work session
   */
  endSession(): WorkSession | null {
    if (!this.currentSession) return null;

    this.currentSession.endTime = new Date();
    this.workSessions.push(this.currentSession);

    const session = this.currentSession;
    this.currentSession = null;
    return session;
  }

  /**
   * Record a completed task in the current session
   */
  recordCompletion(task: string): void {
    if (this.currentSession) {
      this.currentSession.tasksCompleted.push(task);
    }
  }

  /**
   * Record a blocked task in the current session
   */
  recordBlocker(task: string, reason: string): void {
    if (this.currentSession) {
      this.currentSession.tasksBlocked.push(`${task}: ${reason}`);
    }
  }

  /**
   * Record an insight or learning
   */
  recordInsight(insight: string): void {
    if (this.currentSession) {
      this.currentSession.insights.push(insight);
    }
  }

  /**
   * Get a summary of recent sessions
   */
  getRecentSessions(count: number = 5): WorkSession[] {
    return this.workSessions.slice(-count);
  }

  /**
   * Generate a daily summary
   */
  generateDailySummary(date: string): DailySummary {
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const daySessions = this.workSessions.filter(s =>
      s.startTime >= dayStart && s.startTime < dayEnd
    );

    const allCompleted = daySessions.flatMap(s => s.tasksCompleted);
    const allBlocked = daySessions.flatMap(s => s.tasksBlocked);
    const allInsights = daySessions.flatMap(s => s.insights);
    const allNextSteps = daySessions.flatMap(s => s.nextSteps);

    return {
      date,
      totalTasksCompleted: allCompleted.length,
      totalTasksBlocked: allBlocked.length,
      keyAccomplishments: this.prioritize(allCompleted, 5),
      lessonsLearned: this.prioritize(allInsights, 3),
      tomorrowPriorities: this.prioritize(allNextSteps, 3),
    };
  }

  /**
   * Get prompt for time management
   */
  getTimeManagementPrompt(availableHours: number, tasks: string[]): string {
    return `I have ${availableHours} hours available. Here are the tasks:

${tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Help me:
1. Estimate time for each task
2. Prioritize based on impact and urgency
3. Create a realistic schedule
4. Identify what might not fit
5. Suggest what to delegate or defer if needed

Be realistic - I'd rather under-promise and over-deliver.`;
  }

  /**
   * Get prompt for focus assistance
   */
  getFocusPrompt(task: string, distractions: string[]): string {
    return `I need to focus on: ${task}

Common distractions I face:
${distractions.map(d => `- ${d}`).join('\n')}

Help me:
1. Break this into focused work blocks
2. Identify specific deliverables for each block
3. Set up my environment for success
4. Plan how to handle interruptions
5. Define clear "done" criteria so I know when to stop`;
  }

  private prioritize(items: string[], count: number): string[] {
    // Simple prioritization - take unique items
    const unique = [...new Set(items)];
    return unique.slice(0, count);
  }
}

// ============================================================
// TaskAssistant - Help with task management
// ============================================================

export class TaskAssistant {
  /**
   * Break down a complex task into manageable subtasks
   */
  breakdownTask(task: string, context?: string): TaskBreakdown {
    // This provides structure - the actual breakdown would be done by the LLM
    const breakdown: TaskBreakdown = {
      originalTask: task,
      subtasks: [],
      estimatedTotalEffort: 'medium',
      suggestedApproach: '',
      potentialBlockers: [],
      successCriteria: [],
    };

    return breakdown;
  }

  /**
   * Get prompt for task breakdown
   */
  getBreakdownPrompt(task: string, context?: string): string {
    return `I need to accomplish: "${task}"
${context ? `\nContext: ${context}` : ''}

Please help me break this down:

1. **Clarify the goal** - What does "done" look like?
2. **Identify subtasks** - What are all the pieces?
3. **Order them** - What depends on what?
4. **Estimate effort** - How big is each piece?
5. **Spot risks** - What could go wrong?
6. **Define success** - How will I know each part is complete?

Be specific and actionable. I want to be able to start working immediately.`;
  }

  /**
   * Get prompt for choosing between approaches
   */
  getApproachSelectionPrompt(task: string, approaches: string[]): string {
    return `I need to accomplish: "${task}"

Here are some possible approaches:
${approaches.map((a, i) => `${i + 1}. ${a}`).join('\n')}

Help me decide which approach to take by:
1. Listing pros and cons of each
2. Identifying risks and mitigation strategies
3. Estimating effort and timeline for each
4. Considering my constraints (time, resources, skills)
5. Making a clear recommendation with reasoning`;
  }

  /**
   * Get prompt for task prioritization
   */
  getPrioritizationPrompt(tasks: string[], criteria: string[]): string {
    const criteriaList = criteria.length > 0
      ? criteria.map(c => `- ${c}`).join('\n')
      : '- Impact on goals\n- Urgency/deadlines\n- Dependencies\n- Effort required';

    return `I need to prioritize these tasks:
${tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Prioritization criteria:
${criteriaList}

Help me:
1. Score each task against these criteria
2. Identify any quick wins (high impact, low effort)
3. Spot dependencies that affect order
4. Create a prioritized list with reasoning
5. Suggest what to defer or delegate if the list is too long`;
  }

  /**
   * Get prompt for handling a blocked task
   */
  getUnblockingPrompt(task: string, blocker: string, triedSoFar: string[]): string {
    const triedList = triedSoFar.length > 0
      ? triedSoFar.map(t => `- ${t}`).join('\n')
      : '- Nothing yet';

    return `I'm blocked on: "${task}"

The blocker is: ${blocker}

What I've tried so far:
${triedList}

Help me get unblocked by:
1. Understanding the root cause of the block
2. Generating alternative approaches I haven't tried
3. Identifying who or what could help
4. Suggesting a workaround if the block can't be removed
5. Deciding if I should work on something else while blocked`;
  }

  /**
   * Get prompt for task estimation
   */
  getEstimationPrompt(task: string, similarPastTasks?: string[]): string {
    const pastContext = similarPastTasks && similarPastTasks.length > 0
      ? `\nSimilar past tasks for reference:\n${similarPastTasks.map(t => `- ${t}`).join('\n')}`
      : '';

    return `I need to estimate: "${task}"
${pastContext}

Help me create a realistic estimate by:
1. Breaking down what's actually involved
2. Identifying unknowns that add uncertainty
3. Providing a range (best case, likely, worst case)
4. Noting assumptions I'm making
5. Suggesting how to reduce uncertainty if the range is too wide`;
  }
}

// ============================================================
// ResearchHelper - Help with research and information gathering
// ============================================================

export class ResearchHelper {
  /**
   * Get prompt for structured research
   */
  getResearchPrompt(topic: string, purpose: string, depth: 'quick' | 'thorough' | 'exhaustive'): string {
    const depthGuidance = {
      quick: 'I need the essentials quickly. Focus on the most important facts and skip the details.',
      thorough: 'I need a solid understanding. Cover the key aspects with enough detail to be useful.',
      exhaustive: 'I need to know everything. Be comprehensive and include edge cases and nuances.',
    };

    return `Research topic: "${topic}"

Purpose: ${purpose}

Depth needed: ${depthGuidance[depth]}

Please provide:
1. **Summary** - Key points in 2-3 sentences
2. **Main findings** - The important facts and concepts
3. **Different perspectives** - Various viewpoints if relevant
4. **Practical implications** - What this means for my work
5. **Gaps and uncertainties** - What I should know but couldn't find
6. **Sources** - Where this information came from
7. **Next steps** - What to explore further if needed`;
  }

  /**
   * Get prompt for comparing options
   */
  getComparisonPrompt(options: string[], criteria: string[], context?: string): string {
    return `I need to compare these options:
${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}

Evaluation criteria:
${criteria.map(c => `- ${c}`).join('\n')}

${context ? `Context: ${context}\n` : ''}
Please provide:
1. **Overview** - Brief description of each option
2. **Comparison table** - How each scores on each criterion
3. **Pros and cons** - Advantages and disadvantages of each
4. **Use cases** - When each option makes most sense
5. **Recommendation** - Which to choose and why
6. **Caveats** - What could change this recommendation`;
  }

  /**
   * Get prompt for learning a new topic
   */
  getLearningPrompt(topic: string, currentLevel: 'none' | 'basic' | 'intermediate' | 'advanced', goal: string): string {
    const levelContext = {
      none: "I'm starting from zero.",
      basic: 'I know the basics but not much more.',
      intermediate: 'I have working knowledge but want to go deeper.',
      advanced: "I'm already proficient but want to master this.",
    };

    return `I want to learn: "${topic}"

Current level: ${levelContext[currentLevel]}

Goal: ${goal}

Help me learn effectively by:
1. **Starting point** - What I should know first
2. **Core concepts** - The fundamental ideas to understand
3. **Common misconceptions** - What people often get wrong
4. **Practical exercises** - How to apply what I learn
5. **Progress markers** - How I'll know I'm improving
6. **Resources** - What to read, watch, or practice with
7. **Timeline** - Realistic expectation for reaching my goal`;
  }

  /**
   * Get prompt for understanding a codebase
   */
  getCodebaseUnderstandingPrompt(codebasePath: string, questions: string[]): string {
    return `I need to understand the codebase at: ${codebasePath}

Specific questions I have:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Please help me by:
1. **Architecture overview** - How is the code organized?
2. **Key components** - What are the main pieces and what do they do?
3. **Data flow** - How does information move through the system?
4. **Entry points** - Where does execution start?
5. **Dependencies** - What external things does this rely on?
6. **Conventions** - What patterns and styles are used?
7. **Gotchas** - What's non-obvious or surprising?`;
  }

  /**
   * Get prompt for synthesizing information
   */
  getSynthesisPrompt(sources: string[], question: string): string {
    return `I've gathered information from these sources:
${sources.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Question I'm trying to answer: ${question}

Please synthesize this by:
1. **Answer** - Direct answer to my question
2. **Consensus** - What the sources agree on
3. **Conflicts** - Where sources disagree and why
4. **Gaps** - What the sources don't cover
5. **Confidence** - How reliable is this synthesis?
6. **Action items** - What should I do with this information?`;
  }
}

// ============================================================
// Factory functions
// ============================================================

/**
 * Create a new productivity helper instance
 */
export function createProductivityHelper(): ProductivityHelper {
  return new ProductivityHelper();
}

/**
 * Create a new task assistant instance
 */
export function createTaskAssistant(): TaskAssistant {
  return new TaskAssistant();
}

/**
 * Create a new research helper instance
 */
export function createResearchHelper(): ResearchHelper {
  return new ResearchHelper();
}
