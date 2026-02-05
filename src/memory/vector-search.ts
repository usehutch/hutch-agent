/**
 * Vector Search Module
 *
 * Enhanced semantic similarity search leveraging HutchMem's Chroma integration.
 * Provides utilities for:
 * - Semantic memory search with relevance scoring
 * - Memory deduplication via similarity detection
 * - Entity-based retrieval
 * - Context clustering for related memories
 */

import { getHutchMem, Observation, SearchResult } from './bridge.js';
import {
  HUTCHMEM_API_URL,
  HUTCHMEM_PROJECT,
  MEMORY_RELEVANCE_THRESHOLD,
  MEMORY_SEARCH_LIMIT,
} from '../core/config.js';

// ============================================================
// Types
// ============================================================

export interface SimilarityResult {
  observation: Observation;
  score: number;
  matchType: 'semantic' | 'entity' | 'exact';
}

export interface ClusterResult {
  centroid: string;
  observations: Observation[];
  cohesion: number;
}

export interface MemoryContext {
  primary: Observation[];
  related: Observation[];
  entities: string[];
  timeline: {
    before: Observation[];
    after: Observation[];
  };
}

// ============================================================
// Similarity Scoring
// ============================================================

/**
 * Calculate Jaccard similarity between two text strings
 */
export function jaccardSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return intersection / union;
}

/**
 * Calculate n-gram similarity (better for short texts)
 */
export function ngramSimilarity(a: string, b: string, n: number = 3): number {
  if (!a || !b) return 0;

  const getNgrams = (text: string): Set<string> => {
    const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const ngrams = new Set<string>();
    for (let i = 0; i <= clean.length - n; i++) {
      ngrams.add(clean.slice(i, i + n));
    }
    return ngrams;
  };

  const ngramsA = getNgrams(a);
  const ngramsB = getNgrams(b);

  if (ngramsA.size === 0 || ngramsB.size === 0) return 0;

  let intersection = 0;
  for (const ngram of ngramsA) {
    if (ngramsB.has(ngram)) intersection++;
  }

  const union = ngramsA.size + ngramsB.size - intersection;
  return intersection / union;
}

/**
 * Combined similarity score using multiple methods
 */
export function combinedSimilarity(a: string, b: string): number {
  const jaccard = jaccardSimilarity(a, b);
  const ngram = ngramSimilarity(a, b, 3);

  // Weighted combination - ngrams better for short text, jaccard for longer
  const avgLen = (a.length + b.length) / 2;
  const ngramWeight = avgLen < 100 ? 0.7 : 0.3;
  const jaccardWeight = 1 - ngramWeight;

  return jaccard * jaccardWeight + ngram * ngramWeight;
}

// ============================================================
// Semantic Search
// ============================================================

/**
 * Search for semantically similar memories
 */
export async function semanticSearch(
  query: string,
  options?: {
    types?: string[];
    limit?: number;
    minScore?: number;
    project?: string;
  }
): Promise<SimilarityResult[]> {
  const bridge = getHutchMem();

  if (!bridge.isAvailable()) {
    await bridge.refreshAvailability();
  }

  const result = await bridge.search(query, {
    types: options?.types,
    limit: options?.limit || MEMORY_SEARCH_LIMIT,
    project: options?.project || HUTCHMEM_PROJECT,
  });

  // Score results using local similarity as proxy for semantic relevance
  // (HutchMem's Chroma already orders by semantic similarity)
  const minScore = options?.minScore || MEMORY_RELEVANCE_THRESHOLD;

  return result.observations
    .map((obs, index) => {
      // Use position-based scoring (Chroma returns in relevance order)
      // Combined with local text similarity for refinement
      const positionScore = 1 - (index / Math.max(result.observations.length, 1));
      const textScore = combinedSimilarity(query, `${obs.title} ${obs.narrative || ''}`);

      return {
        observation: obs,
        score: positionScore * 0.7 + textScore * 0.3,
        matchType: 'semantic' as const,
      };
    })
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

/**
 * Find duplicates of a candidate memory
 */
export async function findDuplicates(
  content: string,
  options?: {
    threshold?: number;
    types?: string[];
    limit?: number;
  }
): Promise<SimilarityResult[]> {
  const threshold = options?.threshold || 0.8;

  const results = await semanticSearch(content, {
    types: options?.types,
    limit: options?.limit || 20,
    minScore: threshold * 0.7, // Cast wider net, filter after
  });

  return results.filter(r => r.score >= threshold);
}

/**
 * Check if a memory is a duplicate of existing memories
 */
export async function isDuplicate(
  content: string,
  threshold: number = 0.85
): Promise<{ isDuplicate: boolean; existing?: Observation }> {
  const duplicates = await findDuplicates(content, { threshold, limit: 1 });

  if (duplicates.length > 0) {
    return { isDuplicate: true, existing: duplicates[0].observation };
  }

  return { isDuplicate: false };
}

// ============================================================
// Entity-Based Search
// ============================================================

/**
 * Extract entities from text
 */
export function extractEntities(text: string): string[] {
  const entities: Set<string> = new Set();

  // File paths
  const filePaths = text.match(/[\w\-./]+\.(ts|js|json|md|tsx|jsx|py|go|rs|yml|yaml|sql)/gi) || [];
  filePaths.forEach(p => entities.add(p));

  // Technical terms (CamelCase, PascalCase)
  const camelCase = text.match(/\b[A-Z][a-z]+[A-Z][a-zA-Z]*\b/g) || [];
  camelCase.forEach(t => entities.add(t));

  // snake_case terms
  const snakeCase = text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) || [];
  snakeCase.forEach(t => entities.add(t));

  // Quoted strings
  const quoted = text.match(/[`"']([^`"']{3,50})[`"']/g) || [];
  quoted.forEach(q => entities.add(q.replace(/[`"']/g, '')));

  // URLs
  const urls = text.match(/https?:\/\/[^\s]+/g) || [];
  urls.forEach(u => entities.add(u.split('?')[0])); // Remove query params

  // Package names (npm-style)
  const packages = text.match(/(?:@[\w-]+\/)?[\w-]+(?:@[\d.]+)?/g) || [];
  packages.filter(p => p.includes('-') || p.includes('@')).forEach(p => entities.add(p));

  return Array.from(entities).slice(0, 20);
}

/**
 * Search for memories containing specific entities
 */
export async function searchByEntities(
  entities: string[],
  options?: {
    matchAll?: boolean;
    limit?: number;
    project?: string;
  }
): Promise<SimilarityResult[]> {
  const query = entities.join(' ');
  const results = await semanticSearch(query, {
    limit: options?.limit || MEMORY_SEARCH_LIMIT * 2,
    project: options?.project,
  });

  if (options?.matchAll) {
    // Filter to only results containing all entities
    return results.filter(r => {
      const obsText = `${r.observation.title} ${r.observation.narrative || ''} ${(r.observation.concepts || []).join(' ')}`.toLowerCase();
      return entities.every(e => obsText.includes(e.toLowerCase()));
    });
  }

  // Score by entity overlap
  return results.map(r => {
    const obsText = `${r.observation.title} ${r.observation.narrative || ''} ${(r.observation.concepts || []).join(' ')}`.toLowerCase();
    const matchCount = entities.filter(e => obsText.includes(e.toLowerCase())).length;
    const entityScore = matchCount / entities.length;

    return {
      ...r,
      score: r.score * 0.5 + entityScore * 0.5,
      matchType: 'entity' as const,
    };
  }).sort((a, b) => b.score - a.score);
}

// ============================================================
// Context Building
// ============================================================

/**
 * Build rich context around a topic
 */
export async function buildContext(
  query: string,
  options?: {
    limit?: number;
    includeRelated?: boolean;
    includeTimeline?: boolean;
    project?: string;
  }
): Promise<MemoryContext> {
  const bridge = getHutchMem();
  const limit = options?.limit || 5;

  // Get primary matches
  const primaryResults = await semanticSearch(query, {
    limit,
    project: options?.project,
  });

  const primary = primaryResults.map(r => r.observation);
  const entities = extractEntities(query);

  // Get related memories if requested
  let related: Observation[] = [];
  if (options?.includeRelated && entities.length > 0) {
    const relatedResults = await searchByEntities(entities, {
      limit,
      project: options?.project,
    });

    // Exclude primary results
    const primaryIds = new Set(primary.map(p => p.id));
    related = relatedResults
      .filter(r => !primaryIds.has(r.observation.id))
      .map(r => r.observation);
  }

  // Get timeline context if requested
  let before: Observation[] = [];
  let after: Observation[] = [];

  if (options?.includeTimeline && primary.length > 0) {
    const anchorObs = primary[0];
    const timeline = await bridge.getTimeline({
      anchor: anchorObs.id,
      depthBefore: 3,
      depthAfter: 3,
      project: options?.project,
    });

    const anchorTime = anchorObs.created_at_epoch;

    for (const entry of timeline) {
      if (entry.type === 'observation' && entry.id !== anchorObs.id) {
        const obs = await bridge.getObservation(entry.id as number);
        if (obs) {
          if (entry.timestamp < anchorTime) {
            before.push(obs);
          } else {
            after.push(obs);
          }
        }
      }
    }
  }

  return {
    primary,
    related,
    entities,
    timeline: { before, after },
  };
}

/**
 * Find memories related to a set of observations
 */
export async function findRelated(
  observations: Observation[],
  options?: {
    limit?: number;
    excludeIds?: number[];
  }
): Promise<SimilarityResult[]> {
  // Extract entities and key phrases from input observations
  const allEntities: Set<string> = new Set();
  const allText: string[] = [];

  for (const obs of observations) {
    allText.push(obs.title);
    if (obs.narrative) allText.push(obs.narrative);

    const obsEntities = extractEntities(`${obs.title} ${obs.narrative || ''}`);
    obsEntities.forEach(e => allEntities.add(e));

    (obs.concepts || []).forEach(c => allEntities.add(c));
  }

  // Search using combined entities and text
  const query = [...allEntities].slice(0, 10).join(' ') + ' ' + allText.slice(0, 2).join(' ');
  const results = await semanticSearch(query, {
    limit: (options?.limit || 10) * 2,
  });

  // Exclude specified IDs and input observations
  const excludeIds = new Set([
    ...(options?.excludeIds || []),
    ...observations.map(o => o.id),
  ]);

  return results.filter(r => !excludeIds.has(r.observation.id)).slice(0, options?.limit || 10);
}

// ============================================================
// Clustering
// ============================================================

/**
 * Cluster observations by topic similarity
 */
export function clusterByTopic(
  observations: Observation[],
  numClusters: number = 3
): ClusterResult[] {
  if (observations.length <= numClusters) {
    // Not enough to cluster meaningfully
    return observations.map(obs => ({
      centroid: obs.title,
      observations: [obs],
      cohesion: 1,
    }));
  }

  // Simple greedy clustering based on text similarity
  const clusters: ClusterResult[] = [];
  const assigned = new Set<number>();

  // Pick initial centroids (most diverse observations)
  const getText = (obs: Observation) => `${obs.title} ${obs.narrative || ''}`;

  for (let i = 0; i < numClusters && assigned.size < observations.length; i++) {
    // Find observation most different from existing centroids
    let bestObs: Observation | null = null;
    let bestMinDist = -1;

    for (const obs of observations) {
      if (assigned.has(obs.id)) continue;

      let minDist = 1;
      for (const cluster of clusters) {
        const dist = 1 - combinedSimilarity(getText(obs), cluster.centroid);
        minDist = Math.min(minDist, dist);
      }

      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestObs = obs;
      }
    }

    if (bestObs) {
      clusters.push({
        centroid: getText(bestObs),
        observations: [bestObs],
        cohesion: 1,
      });
      assigned.add(bestObs.id);
    }
  }

  // Assign remaining observations to nearest cluster
  for (const obs of observations) {
    if (assigned.has(obs.id)) continue;

    let bestCluster = 0;
    let bestSim = -1;

    for (let i = 0; i < clusters.length; i++) {
      const sim = combinedSimilarity(getText(obs), clusters[i].centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestCluster = i;
      }
    }

    clusters[bestCluster].observations.push(obs);
    assigned.add(obs.id);
  }

  // Calculate cohesion for each cluster
  for (const cluster of clusters) {
    if (cluster.observations.length <= 1) {
      cluster.cohesion = 1;
      continue;
    }

    let totalSim = 0;
    let count = 0;

    for (let i = 0; i < cluster.observations.length; i++) {
      for (let j = i + 1; j < cluster.observations.length; j++) {
        totalSim += combinedSimilarity(
          getText(cluster.observations[i]),
          getText(cluster.observations[j])
        );
        count++;
      }
    }

    cluster.cohesion = count > 0 ? totalSim / count : 0;
  }

  return clusters.sort((a, b) => b.observations.length - a.observations.length);
}

// ============================================================
// Singleton Instance
// ============================================================

export class VectorSearchManager {
  private cacheTimeout: number = 60000; // 1 minute
  private queryCache: Map<string, { result: SimilarityResult[]; timestamp: number }> = new Map();

  /**
   * Cached semantic search
   */
  async search(query: string, options?: Parameters<typeof semanticSearch>[1]): Promise<SimilarityResult[]> {
    const cacheKey = JSON.stringify({ query, options });
    const cached = this.queryCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.result;
    }

    const result = await semanticSearch(query, options);

    this.queryCache.set(cacheKey, { result, timestamp: Date.now() });

    // Cleanup old cache entries
    if (this.queryCache.size > 100) {
      const now = Date.now();
      for (const [key, value] of this.queryCache) {
        if (now - value.timestamp > this.cacheTimeout) {
          this.queryCache.delete(key);
        }
      }
    }

    return result;
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.queryCache.clear();
  }
}

let instance: VectorSearchManager | null = null;

export function getVectorSearch(): VectorSearchManager {
  if (!instance) {
    instance = new VectorSearchManager();
  }
  return instance;
}
