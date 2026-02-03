/**
 * Colosseum Hackathon Integration
 *
 * Full integration with Colosseum Agent Hackathon API:
 * - Registration & status
 * - Project creation, updates, submission
 * - Forum engagement (posts, comments, voting)
 * - Leaderboard tracking
 * - Heartbeat monitoring
 */

const COLOSSEUM_API = 'https://agents.colosseum.com/api';
const COLOSSEUM_BASE = 'https://colosseum.com';

// Rate limits from skill.md
const RATE_LIMITS = {
  registration: { requests: 5, perMinutes: 1 },
  general: { requests: 30, perHour: 1 },
  forumVotes: { requests: 120, perHour: 1 },
};

export interface Agent {
  id: string;
  name: string;
  apiKey: string;
  claimCode: string;
  verificationCode: string;
  registeredAt: string;
}

export interface Project {
  id?: string;
  name: string;
  description: string;
  githubUrl: string;
  solanaExplanation: string;  // Max 1000 chars
  tags: string[];             // 1-3 tags from allowed list
  demoUrl?: string;
  videoUrl?: string;
  status?: 'draft' | 'submitted';
  agentVotes?: number;
  humanVotes?: number;
}

export interface ForumPost {
  id?: string;
  title: string;
  content: string;
  purposeTag: 'team-formation' | 'product-feedback' | 'ideation' | 'progress-update';
  categoryTags: string[];
}

export interface LeaderboardEntry {
  rank: number;
  projectId: string;
  projectName: string;
  agentVotes: number;
  humanVotes: number;
}

// Allowed tags for projects
export const ALLOWED_TAGS = [
  'defi', 'stablecoins', 'rwas', 'infra', 'privacy', 'consumer',
  'payments', 'trading', 'depin', 'governance', 'new-markets', 'ai', 'security', 'identity'
] as const;

export class ColosseumWorker {
  private apiKey: string | null = null;
  private agentId: string | null = null;
  private claimCode: string | null = null;
  private projectId: string | null = null;
  private lastHeartbeat: number = 0;

  constructor() {
    // Load from environment if available
    this.apiKey = process.env.COLOSSEUM_API_KEY || null;
    this.agentId = process.env.COLOSSEUM_AGENT_ID || null;
  }

  /**
   * Check if we're registered
   */
  isRegistered(): boolean {
    return !!this.apiKey && !!this.agentId;
  }

  /**
   * Get auth headers
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  // ─────────────────────────────────────────────────────────────
  // Registration & Status
  // ─────────────────────────────────────────────────────────────

  /**
   * Register as an agent (SAVE THE API KEY - shown only once!)
   */
  async register(agentName: string): Promise<{
    success: boolean;
    agent?: Agent;
    error?: string;
  }> {
    try {
      const response = await fetch(`${COLOSSEUM_API}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agentName }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Registration failed: ${error}` };
      }

      const data = await response.json() as {
        id: string;
        name: string;
        api_key: string;
        claim_code: string;
        verification_code: string;
        created_at: string;
      };

      const agent: Agent = {
        id: data.id,
        name: data.name,
        apiKey: data.api_key,
        claimCode: data.claim_code,
        verificationCode: data.verification_code,
        registeredAt: data.created_at,
      };

      // Store for future use
      this.apiKey = agent.apiKey;
      this.agentId = agent.id;
      this.claimCode = agent.claimCode;

      console.log(`[Colosseum] Registered as ${agent.name}`);
      console.log(`[Colosseum] IMPORTANT - Claim code for human: ${agent.claimCode}`);

      return { success: true, agent };

    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get current agent status and metrics
   */
  async getStatus(): Promise<{
    success: boolean;
    status?: any;
    error?: string;
  }> {
    if (!this.isRegistered()) {
      return { success: false, error: 'Not registered' };
    }

    try {
      const response = await fetch(`${COLOSSEUM_API}/agents/status`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return { success: false, error: `Status fetch failed: ${response.status}` };
      }

      const status = await response.json();
      return { success: true, status };

    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Project Management
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a draft project
   */
  async createProject(project: Omit<Project, 'id' | 'status'>): Promise<{
    success: boolean;
    projectId?: string;
    error?: string;
  }> {
    if (!this.isRegistered()) {
      return { success: false, error: 'Not registered' };
    }

    // Validate
    if (project.solanaExplanation.length > 1000) {
      return { success: false, error: 'Solana explanation exceeds 1000 chars' };
    }
    if (project.tags.length < 1 || project.tags.length > 3) {
      return { success: false, error: 'Must have 1-3 tags' };
    }

    try {
      const response = await fetch(`${COLOSSEUM_API}/my-project`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          name: project.name,
          description: project.description,
          github_url: project.githubUrl,
          solana_explanation: project.solanaExplanation,
          tags: project.tags,
          demo_url: project.demoUrl,
          video_url: project.videoUrl,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Project creation failed: ${error}` };
      }

      const data = await response.json() as { id: string };
      this.projectId = data.id;

      console.log(`[Colosseum] Created project: ${project.name} (${data.id})`);
      return { success: true, projectId: data.id };

    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Update project (only while in draft status)
   */
  async updateProject(updates: Partial<Project>): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!this.isRegistered()) {
      return { success: false, error: 'Not registered' };
    }

    try {
      const response = await fetch(`${COLOSSEUM_API}/my-project`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Project update failed: ${error}` };
      }

      console.log('[Colosseum] Project updated');
      return { success: true };

    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Submit project for judging (PERMANENT - cannot be undone!)
   */
  async submitProject(): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!this.isRegistered()) {
      return { success: false, error: 'Not registered' };
    }

    console.log('[Colosseum] WARNING: Submitting project - this cannot be undone!');

    try {
      const response = await fetch(`${COLOSSEUM_API}/my-project/submit`, {
        method: 'POST',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Submission failed: ${error}` };
      }

      console.log('[Colosseum] Project submitted for judging!');
      return { success: true };

    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Forum Engagement
  // ─────────────────────────────────────────────────────────────

  /**
   * Get forum posts
   */
  async getForumPosts(options?: {
    limit?: number;
    category?: string;
  }): Promise<{
    success: boolean;
    posts?: any[];
    error?: string;
  }> {
    try {
      const params = new URLSearchParams();
      if (options?.limit) params.set('limit', String(options.limit));
      if (options?.category) params.set('category', options.category);

      const response = await fetch(`${COLOSSEUM_API}/forum/posts?${params}`);

      if (!response.ok) {
        return { success: false, error: `Forum fetch failed: ${response.status}` };
      }

      const posts = await response.json();
      return { success: true, posts: posts as any[] };

    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Search forum
   */
  async searchForum(query: string): Promise<{
    success: boolean;
    results?: any[];
    error?: string;
  }> {
    try {
      const response = await fetch(
        `${COLOSSEUM_API}/forum/search?q=${encodeURIComponent(query)}`
      );

      if (!response.ok) {
        return { success: false, error: `Search failed: ${response.status}` };
      }

      const results = await response.json();
      return { success: true, results: results as any[] };

    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Create a forum post
   */
  async createForumPost(post: ForumPost): Promise<{
    success: boolean;
    postId?: string;
    error?: string;
  }> {
    if (!this.isRegistered()) {
      return { success: false, error: 'Not registered' };
    }

    try {
      const response = await fetch(`${COLOSSEUM_API}/forum/posts`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          title: post.title,
          content: post.content,
          purpose_tag: post.purposeTag,
          category_tags: post.categoryTags,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Post creation failed: ${error}` };
      }

      const data = await response.json() as { id: string };
      console.log(`[Colosseum] Created forum post: ${post.title}`);
      return { success: true, postId: data.id };

    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Vote on a project
   */
  async voteOnProject(projectId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!this.isRegistered()) {
      return { success: false, error: 'Not registered' };
    }

    try {
      const response = await fetch(`${COLOSSEUM_API}/projects/${projectId}/vote`, {
        method: 'POST',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Vote failed: ${error}` };
      }

      return { success: true };

    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Leaderboard & Discovery
  // ─────────────────────────────────────────────────────────────

  /**
   * Get leaderboard
   */
  async getLeaderboard(): Promise<{
    success: boolean;
    leaderboard?: LeaderboardEntry[];
    error?: string;
  }> {
    try {
      const response = await fetch(`${COLOSSEUM_API}/leaderboard`);

      if (!response.ok) {
        return { success: false, error: `Leaderboard fetch failed: ${response.status}` };
      }

      const data = await response.json();
      return { success: true, leaderboard: data as LeaderboardEntry[] };

    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get all projects
   */
  async getProjects(): Promise<{
    success: boolean;
    projects?: Project[];
    error?: string;
  }> {
    try {
      const response = await fetch(`${COLOSSEUM_API}/projects`);

      if (!response.ok) {
        return { success: false, error: `Projects fetch failed: ${response.status}` };
      }

      const data = await response.json();
      return { success: true, projects: data as Project[] };

    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Heartbeat & Updates
  // ─────────────────────────────────────────────────────────────

  /**
   * Check heartbeat for updates (recommended every ~30 minutes)
   */
  async checkHeartbeat(): Promise<{
    success: boolean;
    updates?: any;
    error?: string;
  }> {
    try {
      const response = await fetch(`${COLOSSEUM_BASE}/heartbeat.md`);

      if (!response.ok) {
        return { success: false, error: `Heartbeat failed: ${response.status}` };
      }

      const content = await response.text();
      this.lastHeartbeat = Date.now();

      // Parse heartbeat content for updates
      return { success: true, updates: { raw: content, checkedAt: this.lastHeartbeat } };

    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Should we check heartbeat?
   */
  shouldCheckHeartbeat(): boolean {
    const thirtyMinutes = 30 * 60 * 1000;
    return Date.now() - this.lastHeartbeat > thirtyMinutes;
  }

  // ─────────────────────────────────────────────────────────────
  // Claim Code for Human
  // ─────────────────────────────────────────────────────────────

  /**
   * Get claim info for human operator
   */
  getClaimInfo(): {
    claimCode: string | null;
    claimUrl: string | null;
    instructions: string;
  } {
    return {
      claimCode: this.claimCode,
      claimUrl: this.claimCode ? `${COLOSSEUM_BASE}/claim/${this.claimCode}` : null,
      instructions: `
Human operator: To claim prizes and link your identity:
1. Go to the claim URL
2. Sign in with your X (Twitter) account
3. Connect your Solana wallet
4. You're set to receive prizes if we win!
      `.trim(),
    };
  }
}
