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
   * Get URLs to research for hackathon
   */
  getHackathonResearchUrls(): {
    category: string;
    urls: string[];
  }[] {
    return [
      {
        category: 'Colosseum Hackathon',
        urls: [
          'https://colosseum.com/agent-hackathon',
          'https://colosseum.com/forum',
          'https://colosseum.com/projects',
          'https://colosseum.com/leaderboard',
        ],
      },
      {
        category: 'Solana Development',
        urls: [
          'https://docs.solana.com',
          'https://www.anchor-lang.com/docs',
          'https://solana.stackexchange.com',
        ],
      },
      {
        category: 'AI Agent Frameworks',
        urls: [
          'https://docs.anthropic.com',
          'https://github.com/anthropics/claude-code',
        ],
      },
      {
        category: 'Competitor Analysis',
        urls: [
          'https://github.com/topics/ai-agent',
          'https://github.com/topics/solana-program',
        ],
      },
    ];
  }

  /**
   * Get daily research tasks for hackathon
   */
  getDailyResearchTasks(): ResearchTask[] {
    return [
      {
        topic: 'Colosseum hackathon forum - new posts and discussions',
        type: 'discussion',
        sources: ['https://colosseum.com/forum'],
        depth: 'thorough',
      },
      {
        topic: 'Competitor projects on leaderboard',
        type: 'competitor',
        sources: ['https://colosseum.com/leaderboard', 'https://colosseum.com/projects'],
        depth: 'quick',
      },
      {
        topic: 'AI agent best practices and patterns',
        type: 'technical',
        depth: 'quick',
      },
    ];
  }

  /**
   * Analyze competition (prompt for Claude)
   */
  getCompetitorAnalysisPrompt(): string {
    return `Analyze the current hackathon competition:

1. Check the leaderboard at colosseum.com/leaderboard
2. Review top projects at colosseum.com/projects
3. Identify:
   - What types of projects are doing well
   - Common features among top projects
   - Gaps we could fill
   - Unique approaches we could take

4. For each major competitor:
   - Project name and description
   - Their approach
   - Strengths
   - Weaknesses
   - How we differentiate

Provide actionable insights for our NEXUS Protocol strategy.`;
  }

  /**
   * Get engagement opportunities (prompt for Claude)
   */
  getEngagementPrompt(): string {
    return `Find engagement opportunities on the Colosseum forum:

1. Check recent posts at colosseum.com/forum
2. Look for:
   - Questions we can answer
   - Discussions we can contribute to
   - Collaboration opportunities
   - Feedback requests we can help with

3. For each opportunity:
   - Post title and link
   - How we can contribute
   - Potential benefit for NEXUS visibility

Remember: Be genuinely helpful, not spammy. Quality > quantity.`;
  }
}
