/**
 * HutchMem Bridge
 *
 * Clean interface for querying the HutchMem memory system.
 * The agent uses existing HutchMem hooks for recording (automatic),
 * this module handles explicit queries for past experience.
 */

const HUTCHMEM_API = process.env.HUTCHMEM_API_URL || 'http://localhost:37777';

export interface Observation {
  id: number;
  type: 'feature' | 'bugfix' | 'decision' | 'discovery' | 'refactor' | 'change';
  title: string;
  narrative?: string;
  files?: string[];
  timestamp: string;
}

export interface SearchResult {
  observations: Observation[];
  total: number;
}

export class HutchMemBridge {
  private apiUrl: string;
  private available: boolean = false;

  constructor(apiUrl?: string) {
    this.apiUrl = apiUrl || HUTCHMEM_API;
    this.checkAvailability();
  }

  /**
   * Check if HutchMem is available
   */
  private async checkAvailability(): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/api/health`, {
        method: 'GET',
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
   * Search for relevant observations
   */
  async search(query: string, options?: {
    types?: string[];
    limit?: number;
    files?: string[];
  }): Promise<SearchResult> {
    if (!this.available) {
      return { observations: [], total: 0 };
    }

    try {
      const params = new URLSearchParams({
        q: query,
        limit: String(options?.limit || 10),
      });

      if (options?.types?.length) {
        params.set('types', options.types.join(','));
      }

      const response = await fetch(`${this.apiUrl}/api/search?${params}`);

      if (!response.ok) {
        return { observations: [], total: 0 };
      }

      const data = await response.json() as {
        observations?: Observation[];
        total?: number;
      };
      return {
        observations: data.observations || [],
        total: data.total || 0,
      };

    } catch {
      return { observations: [], total: 0 };
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
   * Get approach statistics (from past observations)
   */
  async getApproachStats(): Promise<Record<string, { successes: number; failures: number }>> {
    // This would require a dedicated endpoint in HutchMem
    // For now, return empty stats
    return {};
  }

  /**
   * Record an observation (typically done via hooks, but available for explicit recording)
   */
  async record(observation: {
    type: string;
    title: string;
    narrative: string;
    files?: string[];
  }): Promise<boolean> {
    if (!this.available) {
      return false;
    }

    try {
      const response = await fetch(`${this.apiUrl}/api/observations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(observation),
      });

      return response.ok;

    } catch {
      return false;
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
