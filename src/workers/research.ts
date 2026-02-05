/**
 * Research Worker
 *
 * Handles web research and analysis:
 * - Competitor analysis
 * - Documentation lookup
 * - Forum/discussion monitoring
 * - Technical research
 *
 * Note: Actual web fetching is done by Claude Code's WebFetch/WebSearch.
 * This worker provides structure and prompts for research tasks.
 */

export interface ResearchTask {
  topic: string;
  type: 'competitor' | 'documentation' | 'discussion' | 'technical' | 'general';
  sources?: string[];
  depth: 'quick' | 'thorough' | 'deep';
}

export interface ResearchResult {
  topic: string;
  summary: string;
  keyFindings: string[];
  sources: string[];
  relevantLinks: string[];
  nextSteps?: string[];
}

export class ResearchWorker {

  /**
   * Generate research prompt for Claude
   */
  getResearchPrompt(task: ResearchTask): string {
    const prompts: Record<string, string> = {
      competitor: `Research competitors in the space of: ${task.topic}

Look for:
1. Similar projects and their approaches
2. What features they have
3. Their strengths and weaknesses
4. How we can differentiate
5. Lessons we can learn

Be thorough but concise. Focus on actionable insights.`,

      documentation: `Research documentation for: ${task.topic}

Find:
1. Official documentation
2. Best practices
3. Common patterns
4. Code examples
5. Known issues or gotchas

Prioritize official sources and well-maintained resources.`,

      discussion: `Research discussions and community sentiment about: ${task.topic}

Look for:
1. Forum discussions
2. Reddit threads
3. Twitter conversations
4. GitHub issues
5. Community feedback

Understand what people are saying and what problems they face.`,

      technical: `Deep technical research on: ${task.topic}

Investigate:
1. Architecture and design patterns
2. Implementation details
3. Performance considerations
4. Security implications
5. Integration approaches

Be specific and technical. Include code references where relevant.`,

      general: `Research: ${task.topic}

Gather:
1. Overview and context
2. Key facts and data
3. Different perspectives
4. Current state
5. Future trends

Provide a balanced, comprehensive summary.`,
    };

    let prompt = prompts[task.type] || prompts.general;

    if (task.sources && task.sources.length > 0) {
      prompt += `\n\nPrioritize these sources:\n${task.sources.map(s => `- ${s}`).join('\n')}`;
    }

    if (task.depth === 'quick') {
      prompt += '\n\nKeep it brief - just the essentials.';
    } else if (task.depth === 'deep') {
      prompt += '\n\nBe extremely thorough. Leave no stone unturned.';
    }

    return prompt;
  }

  /**
   * Get useful research URLs for common development topics
   */
  getCommonResearchUrls(): {
    category: string;
    urls: string[];
  }[] {
    return [
      {
        category: 'AI Agent Frameworks',
        urls: [
          'https://docs.anthropic.com',
          'https://github.com/anthropics/claude-code',
          'https://github.com/topics/ai-agent',
        ],
      },
      {
        category: 'Development Resources',
        urls: [
          'https://developer.mozilla.org',
          'https://nodejs.org/docs',
          'https://docs.github.com',
        ],
      },
      {
        category: 'TypeScript/JavaScript',
        urls: [
          'https://www.typescriptlang.org/docs',
          'https://bun.sh/docs',
          'https://deno.land/manual',
        ],
      },
    ];
  }

  /**
   * Get daily research tasks for general development
   */
  getDailyResearchTasks(): ResearchTask[] {
    return [
      {
        topic: 'Latest updates in AI agent development',
        type: 'technical',
        depth: 'quick',
      },
      {
        topic: 'Best practices for the current project',
        type: 'documentation',
        depth: 'thorough',
      },
    ];
  }

  /**
   * Analyze competition for a given project type
   */
  getCompetitorAnalysisPrompt(projectType: string): string {
    return `Analyze the current competition for: ${projectType}

1. Search for similar projects
2. Review popular implementations
3. Identify:
   - What types of approaches are common
   - What features users expect
   - Gaps that could be filled
   - Unique approaches that could differentiate us

4. For each major competitor:
   - Project name and description
   - Their approach
   - Strengths
   - Weaknesses
   - How we can differentiate

Provide actionable insights for our project strategy.`;
  }

  /**
   * Get engagement opportunities prompt for community involvement
   */
  getEngagementPrompt(community: string): string {
    return `Find engagement opportunities in: ${community}

1. Look for:
   - Questions we can answer
   - Discussions we can contribute to
   - Collaboration opportunities
   - Feedback requests we can help with

2. For each opportunity:
   - Post title and link
   - How we can contribute
   - Potential benefit

Remember: Be genuinely helpful, not spammy. Quality > quantity.`;
  }
}
