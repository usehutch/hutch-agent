/**
 * Memory Extraction Pipeline
 *
 * Mem0-inspired architecture for extracting, consolidating, and storing
 * memories from agent cycles. This is the core of the learning system.
 *
 * Architecture:
 * 1. EXTRACT: Pull candidate memories from cycle output
 * 2. COMPARE: Find similar existing memories
 * 3. RESOLVE: Merge, update, or add new memories
 * 4. STORE: Persist to HutchMem with proper typing
 */

import {
  HUTCHMEM_API_URL,
  HUTCHMEM_TIMEOUT_MS,
  HUTCHMEM_PROJECT,
  MEMORY_SEARCH_LIMIT,
  MEMORY_RELEVANCE_THRESHOLD,
} from '../core/config.js';

// ============================================================
// Types
// ============================================================

export interface CandidateMemory {
  /** Unique identifier */
  id: string;
  /** Type of memory */
  type: 'fact' | 'preference' | 'skill' | 'insight' | 'correction';
  /** Main content */
  content: string;
  /** Extracted entities */
  entities: string[];
  /** Confidence score 0-1 */
  confidence: number;
  /** Source context */
  source: {
    cycleId: string;
    taskName: string;
    timestamp: number;
  };
}

export interface ExistingMemory {
  id: number;
  title: string;
  subtitle?: string;
  narrative?: string;
  type: string;
  confidence: number;
  created_at_epoch: number;
  occurrence_count: number;
}

export interface MemoryResolution {
  action: 'add' | 'merge' | 'update' | 'skip';
  candidate: CandidateMemory;
  existing?: ExistingMemory;
  reason: string;
}

export interface ExtractionResult {
  candidates: CandidateMemory[];
  resolutions: MemoryResolution[];
  stored: number;
  merged: number;
  skipped: number;
}

// ============================================================
// Memory Extraction
// ============================================================

/**
 * Extract candidate memories from cycle output
 */
export function extractCandidates(
  cycleOutput: string,
  context: {
    cycleId: string;
    taskName: string;
    success: boolean;
    toolsUsed: string[];
  }
): CandidateMemory[] {
  const candidates: CandidateMemory[] = [];
  const timestamp = Date.now();

  // Extract facts from successful operations
  if (context.success) {
    // Look for file operations
    const filePatterns = [
      /(?:Created|Wrote|Edited)\s+(?:file\s+)?[`"]?([^`"\n]+)[`"]?/gi,
      /(?:Added|Updated|Modified)\s+[`"]?([^`"\n]+)[`"]?/gi,
    ];

    for (const pattern of filePatterns) {
      const matches = cycleOutput.matchAll(pattern);
      for (const match of matches) {
        candidates.push({
          id: `fact-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'fact',
          content: match[0].slice(0, 200),
          entities: extractEntities(match[0]),
          confidence: 0.8,
          source: { cycleId: context.cycleId, taskName: context.taskName, timestamp },
        });
      }
    }

    // Look for completed tasks
    if (cycleOutput.includes('TASK_COMPLETE')) {
      candidates.push({
        id: `skill-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'skill',
        content: `Successfully completed: ${context.taskName}`,
        entities: [context.taskName, ...context.toolsUsed],
        confidence: 0.9,
        source: { cycleId: context.cycleId, taskName: context.taskName, timestamp },
      });
    }
  }

  // Extract insights from any output
  const insightPatterns = [
    /(?:learned|discovered|found out|realized)\s+(?:that\s+)?(.{20,200})/gi,
    /(?:important|note|remember):\s*(.{20,200})/gi,
    /(?:the issue was|problem was|root cause)\s+(.{20,200})/gi,
  ];

  for (const pattern of insightPatterns) {
    const matches = cycleOutput.matchAll(pattern);
    for (const match of matches) {
      candidates.push({
        id: `insight-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'insight',
        content: match[1].trim().slice(0, 200),
        entities: extractEntities(match[1]),
        confidence: 0.7,
        source: { cycleId: context.cycleId, taskName: context.taskName, timestamp },
      });
    }
  }

  // Extract corrections (when something was fixed)
  const correctionPatterns = [
    /(?:fixed|corrected|resolved)\s+(.{20,200})/gi,
    /(?:changed from|replaced)\s+(.{20,100})\s+(?:to|with)\s+(.{20,100})/gi,
  ];

  for (const pattern of correctionPatterns) {
    const matches = cycleOutput.matchAll(pattern);
    for (const match of matches) {
      candidates.push({
        id: `correction-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'correction',
        content: match[0].slice(0, 200),
        entities: extractEntities(match[0]),
        confidence: 0.85,
        source: { cycleId: context.cycleId, taskName: context.taskName, timestamp },
      });
    }
  }

  // Deduplicate similar candidates
  return deduplicateCandidates(candidates);
}

/**
 * Extract entities (nouns, file names, technical terms) from text
 */
function extractEntities(text: string): string[] {
  const entities: Set<string> = new Set();

  // File paths
  const filePaths = text.match(/[\w\-./]+\.(ts|js|json|md|tsx|jsx|py|go|rs)/gi) || [];
  filePaths.forEach(p => entities.add(p));

  // Technical terms (camelCase, PascalCase, snake_case)
  const techTerms = text.match(/\b[A-Z][a-z]+[A-Z][a-zA-Z]*\b|\b[a-z]+_[a-z_]+\b/g) || [];
  techTerms.forEach(t => entities.add(t));

  // Quoted strings
  const quoted = text.match(/[`"']([^`"']+)[`"']/g) || [];
  quoted.forEach(q => entities.add(q.replace(/[`"']/g, '')));

  return Array.from(entities).slice(0, 10);
}

/**
 * Remove duplicate or very similar candidates
 */
function deduplicateCandidates(candidates: CandidateMemory[]): CandidateMemory[] {
  const unique: CandidateMemory[] = [];

  for (const candidate of candidates) {
    const isDupe = unique.some(existing =>
      calculateSimilarity(existing.content, candidate.content) > 0.8
    );
    if (!isDupe) {
      unique.push(candidate);
    }
  }

  return unique;
}

// ============================================================
// Memory Comparison
// ============================================================

/**
 * Find similar existing memories in HutchMem
 */
export async function findSimilarMemories(
  candidate: CandidateMemory
): Promise<ExistingMemory[]> {
  try {
    const authToken = await getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    // Search by content
    const response = await fetch(`${HUTCHMEM_API_URL}/api/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: candidate.content.slice(0, 100),
        limit: MEMORY_SEARCH_LIMIT,
        project: HUTCHMEM_PROJECT,
      }),
      signal: AbortSignal.timeout(HUTCHMEM_TIMEOUT_MS),
    });

    if (!response.ok) {
      return [];
    }

    const results = await response.json() as ExistingMemory[];
    return results;
  } catch (err) {
    console.log(`[MemoryExtraction] Search failed: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Calculate text similarity (Jaccard on words)
 */
function calculateSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return intersection / union;
}

// ============================================================
// Memory Resolution
// ============================================================

/**
 * Resolve how to handle a candidate memory
 */
export function resolveMemory(
  candidate: CandidateMemory,
  similar: ExistingMemory[]
): MemoryResolution {
  // No similar memories - add as new
  if (similar.length === 0) {
    return {
      action: 'add',
      candidate,
      reason: 'No similar memories found',
    };
  }

  // Check for high similarity match
  const bestMatch = similar[0];
  const similarity = calculateSimilarity(candidate.content, bestMatch.title || '');

  // Very high similarity - skip (already known)
  if (similarity > 0.9) {
    return {
      action: 'skip',
      candidate,
      existing: bestMatch,
      reason: `Already known (${Math.round(similarity * 100)}% match)`,
    };
  }

  // High similarity - merge/update
  if (similarity > MEMORY_RELEVANCE_THRESHOLD) {
    // If existing has been seen multiple times, merge
    if (bestMatch.occurrence_count > 1) {
      return {
        action: 'merge',
        candidate,
        existing: bestMatch,
        reason: `Similar to existing (${Math.round(similarity * 100)}% match, ${bestMatch.occurrence_count} occurrences)`,
      };
    }

    // Single occurrence - update with new info
    return {
      action: 'update',
      candidate,
      existing: bestMatch,
      reason: `Updating existing (${Math.round(similarity * 100)}% match)`,
    };
  }

  // Low similarity - add as new
  return {
    action: 'add',
    candidate,
    reason: `Different from existing (${Math.round(similarity * 100)}% max match)`,
  };
}

// ============================================================
// Memory Storage
// ============================================================

/**
 * Store a memory in HutchMem
 */
export async function storeMemory(
  candidate: CandidateMemory,
  resolution: MemoryResolution
): Promise<boolean> {
  try {
    const authToken = await getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    // Map candidate type to HutchMem observation type
    const typeMap: Record<string, string> = {
      fact: 'discovery',
      preference: 'personality',
      skill: 'feature',
      insight: 'discovery',
      correction: 'bugfix',
    };

    const observation = {
      type: typeMap[candidate.type] || 'discovery',
      title: candidate.content.slice(0, 100),
      subtitle: `Extracted from: ${candidate.source.taskName}`,
      narrative: candidate.content,
      facts: JSON.stringify(candidate.entities),
      concepts: JSON.stringify([candidate.type]),
      project: HUTCHMEM_PROJECT,
      confidence: candidate.confidence,
    };

    // If merging, update the existing observation's confidence
    if (resolution.action === 'merge' && resolution.existing) {
      const response = await fetch(
        `${HUTCHMEM_API_URL}/api/observations/${resolution.existing.id}/reinforce`,
        {
          method: 'POST',
          headers,
          signal: AbortSignal.timeout(HUTCHMEM_TIMEOUT_MS),
        }
      );
      return response.ok;
    }

    // Otherwise create new observation
    const response = await fetch(`${HUTCHMEM_API_URL}/api/observations`, {
      method: 'POST',
      headers,
      body: JSON.stringify(observation),
      signal: AbortSignal.timeout(HUTCHMEM_TIMEOUT_MS),
    });

    return response.ok;
  } catch (err) {
    console.log(`[MemoryExtraction] Store failed: ${(err as Error).message}`);
    return false;
  }
}

// ============================================================
// Main Pipeline
// ============================================================

/**
 * Run the full memory extraction pipeline
 */
export async function extractAndStoreMemories(
  cycleOutput: string,
  context: {
    cycleId: string;
    taskName: string;
    success: boolean;
    toolsUsed: string[];
  }
): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    candidates: [],
    resolutions: [],
    stored: 0,
    merged: 0,
    skipped: 0,
  };

  // Phase 1: Extract candidates
  result.candidates = extractCandidates(cycleOutput, context);

  if (result.candidates.length === 0) {
    return result;
  }

  console.log(`[MemoryExtraction] Extracted ${result.candidates.length} candidates`);

  // Phase 2 & 3: Compare and resolve each candidate
  for (const candidate of result.candidates) {
    const similar = await findSimilarMemories(candidate);
    const resolution = resolveMemory(candidate, similar);
    result.resolutions.push(resolution);

    // Phase 4: Store based on resolution
    if (resolution.action === 'skip') {
      result.skipped++;
      continue;
    }

    const stored = await storeMemory(candidate, resolution);
    if (stored) {
      if (resolution.action === 'merge') {
        result.merged++;
      } else {
        result.stored++;
      }
    }
  }

  console.log(`[MemoryExtraction] Stored: ${result.stored}, Merged: ${result.merged}, Skipped: ${result.skipped}`);

  return result;
}

// ============================================================
// Auth Helper
// ============================================================

let cachedAuthToken: string | null = null;

async function getAuthToken(): Promise<string | null> {
  if (cachedAuthToken) return cachedAuthToken;

  try {
    const tokenPath = `${process.env.HOME}/.hutch-mem/.auth-token`;
    const { existsSync, readFileSync } = await import('fs');
    if (existsSync(tokenPath)) {
      cachedAuthToken = readFileSync(tokenPath, 'utf-8').trim();
      return cachedAuthToken;
    }
  } catch {
    // Silently fail
  }
  return null;
}
