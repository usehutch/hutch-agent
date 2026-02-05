/**
 * HutchMem Bridge
 *
 * Clean interface for querying the HutchMem memory system.
 * The agent uses existing HutchMem hooks for recording (automatic),
 * this module handles explicit queries for past experience.
 *
 * Features:
 * - Semantic search (via Chroma vector embeddings)
 * - Skills retrieval (procedural memory)
 * - Timeline navigation
 * - Observation CRUD
 */

import { existsSync, readFileSync } from 'fs';

const HUTCHMEM_API = process.env.HUTCHMEM_API_URL || 'http://localhost:37777';
const DEFAULT_PROJECT = process.env.HUTCHMEM_PROJECT || 'nexus';

export interface Observation {
  id: number;
  type: 'feature' | 'bugfix' | 'decision' | 'discovery' | 'refactor' | 'change' | 'personality';
  title: string;
  subtitle?: string;
  narrative?: string;
  facts?: string[];
  concepts?: string[];
  files_read?: string[];
  files_modified?: string[];
  confidence?: number;
  created_at_epoch: number;
  occurrence_count?: number;
}

export interface SearchResult {
  observations: Observation[];
  total: number;
  usedChroma?: boolean;
}

export interface Skill {
  id: number;
  name: string;
  description: string | null;
  steps: Array<{
    order: number;
    action: string;
    tools?: string[];
    expectedOutcome?: string;
  }>;
  preconditions: string[];
  successCriteria: string[];
  triggerPatterns: string[];
  confidence: number;
  usageCount: number;
  isActive: boolean;
}

export interface SkillMatch {
  skill: Skill;
  matchScore: number;
  matchedPattern: string | null;
}

export interface TimelineEntry {
  type: 'observation' | 'session';
  id: number | string;
  title: string;
  subtitle?: string;
  timestamp: number;
}

export class HutchMemBridge {
  private apiUrl: string;
  private available: boolean = false;
  private authToken: string | null = null;
  private project: string;

  constructor(apiUrl?: string, project?: string) {
    this.apiUrl = apiUrl || HUTCHMEM_API;
    this.project = project || DEFAULT_PROJECT;
    this.loadAuthToken();
    this.checkAvailability();
  }

  /**
   * Load auth token from file
   */
  private loadAuthToken(): void {
    try {
      const tokenPath = `${process.env.HOME}/.hutch-mem/.auth-token`;
      if (existsSync(tokenPath)) {
        this.authToken = readFileSync(tokenPath, 'utf-8').trim();
      }
    } catch {
      // No token available
    }
  }

  /**
   * Get headers with auth
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  /**
   * Check if HutchMem is available
   */
  private async checkAvailability(): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/api/health`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(2000),
      });
      this.available = response.ok;
    } catch {
      this.available = false;
    }
  }

  /**
   * Check if HutchMem is reachable
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Re-check availability (useful after initialization)
   */
  async refreshAvailability(): Promise<boolean> {
    await this.checkAvailability();
    return this.available;
  }

  /**
   * Search for relevant observations (uses Chroma semantic search)
   */
  async search(query: string, options?: {
    types?: string[];
    limit?: number;
    project?: string;
    minConfidence?: number;
  }): Promise<SearchResult> {
    if (!this.available) {
      return { observations: [], total: 0 };
    }

    try {
      const params = new URLSearchParams({
        query,
        limit: String(options?.limit || 10),
        project: options?.project || this.project,
      });

      if (options?.types?.length) {
        params.set('obs_type', options.types.join(','));
      }

      const response = await fetch(`${this.apiUrl}/api/search?${params}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return { observations: [], total: 0 };
      }

      const data = await response.json() as {
        observations?: Observation[];
        total?: number;
        usedChroma?: boolean;
      };

      let observations = data.observations || [];

      // Filter by min confidence if specified
      if (options?.minConfidence) {
        observations = observations.filter(
          o => (o.confidence || 0.5) >= options.minConfidence!
        );
      }

      return {
        observations,
        total: data.total || observations.length,
        usedChroma: data.usedChroma,
      };

    } catch {
      return { observations: [], total: 0 };
    }
  }

  // ============================================================
  // Skills API (Procedural Memory)
  // ============================================================

  /**
   * Get skills matching a query
   */
  async getSkills(options?: {
    query?: string;
    minConfidence?: number;
    limit?: number;
    project?: string;
  }): Promise<Skill[]> {
    if (!this.available) {
      return [];
    }

    try {
      const params = new URLSearchParams({
        project: options?.project || this.project,
        limit: String(options?.limit || 10),
      });

      if (options?.query) {
        params.set('query', options.query);
      }
      if (options?.minConfidence !== undefined) {
        params.set('min_confidence', String(options.minConfidence));
      }

      const response = await fetch(`${this.apiUrl}/api/skills?${params}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { skills?: Skill[] };
      return data.skills || [];

    } catch {
      return [];
    }
  }

  /**
   * Find skills that match a task description
   */
  async matchSkills(taskDescription: string, options?: {
    minConfidence?: number;
    limit?: number;
    project?: string;
  }): Promise<SkillMatch[]> {
    const skills = await this.getSkills({
      query: taskDescription,
      minConfidence: options?.minConfidence || 0.4,
      limit: options?.limit || 5,
      project: options?.project,
    });

    // Score each skill based on trigger pattern matching
    return skills.map(skill => {
      const taskLower = taskDescription.toLowerCase();
      let matchScore = 0.5; // Base score for query match
      let matchedPattern: string | null = null;

      for (const pattern of skill.triggerPatterns) {
        if (taskLower.includes(pattern.toLowerCase())) {
          matchScore = Math.max(matchScore, 0.8);
          matchedPattern = pattern;
        }
      }

      // Boost by confidence
      matchScore *= skill.confidence;

      return { skill, matchScore, matchedPattern };
    }).sort((a, b) => b.matchScore - a.matchScore);
  }

  /**
   * Record skill usage outcome
   */
  async recordSkillUsage(
    skillId: number,
    outcome: 'success' | 'partial' | 'failure' | 'skipped',
    notes?: string
  ): Promise<boolean> {
    if (!this.available) {
      return false;
    }

    try {
      const response = await fetch(`${this.apiUrl}/api/skills/record`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          skill_id: skillId,
          outcome,
          notes,
        }),
      });

      return response.ok;

    } catch {
      return false;
    }
  }

  // ============================================================
  // Timeline API
  // ============================================================

  /**
   * Get timeline around an anchor point
   */
  async getTimeline(options: {
    anchor?: number | string;
    query?: string;
    depthBefore?: number;
    depthAfter?: number;
    project?: string;
  }): Promise<TimelineEntry[]> {
    if (!this.available) {
      return [];
    }

    try {
      const params = new URLSearchParams({
        project: options.project || this.project,
        depth_before: String(options.depthBefore || 5),
        depth_after: String(options.depthAfter || 5),
      });

      if (options.anchor) {
        params.set('anchor', String(options.anchor));
      }
      if (options.query) {
        params.set('query', options.query);
      }

      const response = await fetch(`${this.apiUrl}/api/timeline?${params}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { entries?: TimelineEntry[] };
      return data.entries || [];

    } catch {
      return [];
    }
  }

  /**
   * Get recent context for a project
   */
  async getRecentContext(options?: {
    project?: string;
    limit?: number;
  }): Promise<string> {
    if (!this.available) {
      return '';
    }

    try {
      const params = new URLSearchParams({
        project: options?.project || this.project,
        limit: String(options?.limit || 3),
      });

      const response = await fetch(`${this.apiUrl}/api/context/recent?${params}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return '';
      }

      return await response.text();

    } catch {
      return '';
    }
  }

  /**
   * Find similar errors we've seen before
   */
  async findSimilarError(errorMessage: string): Promise<Observation[]> {
    const result = await this.search(errorMessage, {
      types: ['bugfix'],
      limit: 5,
    });
    return result.observations;
  }

  /**
   * Find past decisions about a topic
   */
  async findDecisions(topic: string): Promise<Observation[]> {
    const result = await this.search(topic, {
      types: ['decision'],
      limit: 5,
    });
    return result.observations;
  }

  /**
   * Find features we've implemented before
   */
  async findFeatures(description: string): Promise<Observation[]> {
    const result = await this.search(description, {
      types: ['feature'],
      limit: 10,
    });
    return result.observations;
  }

  /**
   * Get approach statistics from past observations
   */
  async getApproachStats(): Promise<Record<string, { successes: number; failures: number }>> {
    // Get recent decisions and analyze patterns
    const result = await this.search('approach strategy', {
      types: ['decision'],
      limit: 50,
    });

    const stats: Record<string, { successes: number; failures: number }> = {};

    for (const obs of result.observations) {
      // Extract approach from narrative
      const narrative = obs.narrative?.toLowerCase() || '';
      const approaches = ['incremental', 'direct', 'standard', 'careful', 'research-first'];

      for (const approach of approaches) {
        if (narrative.includes(approach)) {
          if (!stats[approach]) {
            stats[approach] = { successes: 0, failures: 0 };
          }
          // Check if it was successful
          if (narrative.includes('success') || narrative.includes('worked') || narrative.includes('completed')) {
            stats[approach].successes++;
          } else if (narrative.includes('fail') || narrative.includes('error') || narrative.includes('issue')) {
            stats[approach].failures++;
          }
        }
      }
    }

    return stats;
  }

  // ============================================================
  // Observation CRUD
  // ============================================================

  /**
   * Get a specific observation by ID
   */
  async getObservation(id: number): Promise<Observation | null> {
    if (!this.available) {
      return null;
    }

    try {
      const response = await fetch(`${this.apiUrl}/api/observations/${id}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return null;
      }

      return await response.json() as Observation;

    } catch {
      return null;
    }
  }

  /**
   * Get multiple observations by ID
   */
  async getObservations(ids: number[]): Promise<Observation[]> {
    if (!this.available || ids.length === 0) {
      return [];
    }

    try {
      const params = new URLSearchParams({
        ids: ids.join(','),
      });

      const response = await fetch(`${this.apiUrl}/api/observations/batch?${params}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { observations?: Observation[] };
      return data.observations || [];

    } catch {
      return [];
    }
  }

  /**
   * Record an observation (typically done via hooks, but available for explicit recording)
   */
  async record(observation: {
    type: string;
    title: string;
    narrative: string;
    subtitle?: string;
    facts?: string[];
    concepts?: string[];
    files_read?: string[];
    files_modified?: string[];
    project?: string;
    confidence?: number;
  }): Promise<number | null> {
    if (!this.available) {
      return null;
    }

    try {
      const response = await fetch(`${this.apiUrl}/api/observations`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          ...observation,
          project: observation.project || this.project,
        }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as { id?: number };
      return data.id || null;

    } catch {
      return null;
    }
  }

  /**
   * Reinforce an observation (increases confidence)
   */
  async reinforce(observationId: number): Promise<boolean> {
    if (!this.available) {
      return false;
    }

    try {
      const response = await fetch(`${this.apiUrl}/api/observations/${observationId}/reinforce`, {
        method: 'POST',
        headers: this.getHeaders(),
      });

      return response.ok;

    } catch {
      return false;
    }
  }

  // ============================================================
  // Consolidation
  // ============================================================

  /**
   * Trigger memory consolidation
   */
  async consolidate(options?: {
    project?: string;
    dryRun?: boolean;
  }): Promise<{ consolidated: number } | null> {
    if (!this.available) {
      return null;
    }

    try {
      const response = await fetch(`${this.apiUrl}/api/consolidation/run`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          project: options?.project || this.project,
          dry_run: options?.dryRun || false,
        }),
      });

      if (!response.ok) {
        return null;
      }

      return await response.json() as { consolidated: number };

    } catch {
      return null;
    }
  }
}

// Singleton instance
let bridge: HutchMemBridge | null = null;

export function getHutchMem(): HutchMemBridge {
  if (!bridge) {
    bridge = new HutchMemBridge();
  }
  return bridge;
}
