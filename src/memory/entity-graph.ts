/**
 * Entity Graph
 *
 * Knowledge graph for tracking entities and their relationships.
 * Builds a rich semantic network from observations over time.
 *
 * Features:
 * - Entity extraction and normalization
 * - Relationship tracking (co-occurrence, hierarchy, dependency)
 * - Graph traversal for context expansion
 * - Persistence to JSON file
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { AGENT_DIR } from '../core/config.js';
import { Observation, getHutchMem } from './bridge.js';
import { extractEntities } from './vector-search.js';

const ENTITY_GRAPH_FILE = join(AGENT_DIR, 'entity-graph.json');

// ============================================================
// Types
// ============================================================

export type EntityType =
  | 'file'
  | 'function'
  | 'class'
  | 'package'
  | 'concept'
  | 'person'
  | 'tool'
  | 'project'
  | 'url'
  | 'unknown';

export type RelationType =
  | 'co_occurs'      // Entities appear together
  | 'depends_on'     // Entity A depends on B
  | 'implements'     // Entity A implements B
  | 'contains'       // Entity A contains B
  | 'related_to'     // General relationship
  | 'modifies'       // Entity A modifies B
  | 'uses'           // Entity A uses B
  | 'creates'        // Entity A creates B
  | 'fixed_by'       // Entity A fixed by B (bugfixes)
  | 'authored_by';   // Entity A authored by B

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  aliases: string[];
  metadata: Record<string, string | number>;
  occurrenceCount: number;
  lastSeen: number;
  firstSeen: number;
}

export interface Relationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: RelationType;
  weight: number;
  evidence: string[];
  lastUpdated: number;
}

export interface EntityGraph {
  version: number;
  lastUpdated: number;
  entities: Record<string, Entity>;
  relationships: Record<string, Relationship>;
}

export interface GraphQueryResult {
  entity: Entity;
  connections: {
    entity: Entity;
    relationship: Relationship;
    direction: 'outgoing' | 'incoming';
  }[];
}

// ============================================================
// Entity Type Detection
// ============================================================

function detectEntityType(name: string): EntityType {
  // File paths
  if (/\.(ts|js|json|md|tsx|jsx|py|go|rs|yml|yaml|sql|css|html|sh)$/.test(name)) {
    return 'file';
  }

  // URLs
  if (/^https?:\/\//.test(name)) {
    return 'url';
  }

  // Package names
  if (/^@[\w-]+\/[\w-]+$/.test(name) || /^[\w-]+@\d/.test(name)) {
    return 'package';
  }

  // Function-like (lowercase start, may have parentheses)
  if (/^[a-z][a-zA-Z0-9]*\(?\)?$/.test(name)) {
    return 'function';
  }

  // Class-like (PascalCase)
  if (/^[A-Z][a-zA-Z0-9]+$/.test(name)) {
    return 'class';
  }

  // Tool names (common patterns)
  const tools = ['git', 'npm', 'bun', 'node', 'claude', 'docker', 'kubectl', 'aws', 'gcloud'];
  if (tools.includes(name.toLowerCase())) {
    return 'tool';
  }

  // Concepts (multi-word with hyphens or spaces)
  if (name.includes('-') || name.includes('_') || name.includes(' ')) {
    return 'concept';
  }

  return 'unknown';
}

/**
 * Normalize entity name for consistent lookup
 */
function normalizeEntityName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '-');
}

/**
 * Generate entity ID
 */
function generateEntityId(name: string, type: EntityType): string {
  return `${type}:${normalizeEntityName(name)}`;
}

/**
 * Generate relationship ID
 */
function generateRelationshipId(sourceId: string, targetId: string, type: RelationType): string {
  return `${sourceId}--${type}--${targetId}`;
}

// ============================================================
// Entity Graph Manager
// ============================================================

export class EntityGraphManager {
  private graph: EntityGraph;
  private dirty: boolean = false;

  constructor() {
    this.graph = this.load();
  }

  /**
   * Load graph from disk
   */
  private load(): EntityGraph {
    try {
      if (existsSync(ENTITY_GRAPH_FILE)) {
        const data = readFileSync(ENTITY_GRAPH_FILE, 'utf-8');
        return JSON.parse(data) as EntityGraph;
      }
    } catch (err) {
      console.log(`[EntityGraph] Failed to load: ${(err as Error).message}`);
    }

    return {
      version: 1,
      lastUpdated: Date.now(),
      entities: {},
      relationships: {},
    };
  }

  /**
   * Save graph to disk
   */
  save(): void {
    try {
      mkdirSync(AGENT_DIR, { recursive: true });
      this.graph.lastUpdated = Date.now();
      writeFileSync(ENTITY_GRAPH_FILE, JSON.stringify(this.graph, null, 2));
      this.dirty = false;
    } catch (err) {
      console.log(`[EntityGraph] Failed to save: ${(err as Error).message}`);
    }
  }

  /**
   * Auto-save if dirty
   */
  autoSave(): void {
    if (this.dirty) {
      this.save();
    }
  }

  // ============================================================
  // Entity Operations
  // ============================================================

  /**
   * Add or update an entity
   */
  addEntity(
    name: string,
    options?: {
      type?: EntityType;
      aliases?: string[];
      metadata?: Record<string, string | number>;
    }
  ): Entity {
    const type = options?.type || detectEntityType(name);
    const id = generateEntityId(name, type);

    if (this.graph.entities[id]) {
      // Update existing entity
      const entity = this.graph.entities[id];
      entity.occurrenceCount++;
      entity.lastSeen = Date.now();

      if (options?.aliases) {
        for (const alias of options.aliases) {
          if (!entity.aliases.includes(alias)) {
            entity.aliases.push(alias);
          }
        }
      }

      if (options?.metadata) {
        entity.metadata = { ...entity.metadata, ...options.metadata };
      }

      this.dirty = true;
      return entity;
    }

    // Create new entity
    const now = Date.now();
    const entity: Entity = {
      id,
      name,
      type,
      aliases: options?.aliases || [],
      metadata: options?.metadata || {},
      occurrenceCount: 1,
      lastSeen: now,
      firstSeen: now,
    };

    this.graph.entities[id] = entity;
    this.dirty = true;
    return entity;
  }

  /**
   * Get an entity by ID or name
   */
  getEntity(nameOrId: string): Entity | null {
    // Try direct ID lookup
    if (this.graph.entities[nameOrId]) {
      return this.graph.entities[nameOrId];
    }

    // Try by normalized name with various types
    const normalized = normalizeEntityName(nameOrId);
    for (const entity of Object.values(this.graph.entities)) {
      if (normalizeEntityName(entity.name) === normalized) {
        return entity;
      }
      if (entity.aliases.some(a => normalizeEntityName(a) === normalized)) {
        return entity;
      }
    }

    return null;
  }

  /**
   * Find entities by pattern
   */
  findEntities(pattern: string, options?: { type?: EntityType; limit?: number }): Entity[] {
    const regex = new RegExp(pattern, 'i');
    const matches: Entity[] = [];

    for (const entity of Object.values(this.graph.entities)) {
      if (options?.type && entity.type !== options.type) continue;

      if (regex.test(entity.name) || entity.aliases.some(a => regex.test(a))) {
        matches.push(entity);
      }
    }

    // Sort by occurrence count
    matches.sort((a, b) => b.occurrenceCount - a.occurrenceCount);

    return options?.limit ? matches.slice(0, options.limit) : matches;
  }

  // ============================================================
  // Relationship Operations
  // ============================================================

  /**
   * Add or strengthen a relationship
   */
  addRelationship(
    source: string | Entity,
    target: string | Entity,
    type: RelationType,
    evidence?: string
  ): Relationship {
    const sourceEntity = typeof source === 'string' ? this.addEntity(source) : source;
    const targetEntity = typeof target === 'string' ? this.addEntity(target) : target;

    const id = generateRelationshipId(sourceEntity.id, targetEntity.id, type);

    if (this.graph.relationships[id]) {
      // Strengthen existing relationship
      const rel = this.graph.relationships[id];
      rel.weight = Math.min(1, rel.weight + 0.1);
      rel.lastUpdated = Date.now();

      if (evidence && !rel.evidence.includes(evidence)) {
        rel.evidence.push(evidence);
        // Keep only last 10 pieces of evidence
        if (rel.evidence.length > 10) {
          rel.evidence.shift();
        }
      }

      this.dirty = true;
      return rel;
    }

    // Create new relationship
    const relationship: Relationship = {
      id,
      sourceId: sourceEntity.id,
      targetId: targetEntity.id,
      type,
      weight: 0.5,
      evidence: evidence ? [evidence] : [],
      lastUpdated: Date.now(),
    };

    this.graph.relationships[id] = relationship;
    this.dirty = true;
    return relationship;
  }

  /**
   * Get relationships for an entity
   */
  getRelationships(
    entityId: string,
    options?: {
      direction?: 'outgoing' | 'incoming' | 'both';
      type?: RelationType;
      minWeight?: number;
    }
  ): Relationship[] {
    const direction = options?.direction || 'both';
    const minWeight = options?.minWeight || 0;

    return Object.values(this.graph.relationships).filter(rel => {
      if (rel.weight < minWeight) return false;
      if (options?.type && rel.type !== options.type) return false;

      if (direction === 'outgoing') return rel.sourceId === entityId;
      if (direction === 'incoming') return rel.targetId === entityId;
      return rel.sourceId === entityId || rel.targetId === entityId;
    });
  }

  // ============================================================
  // Graph Queries
  // ============================================================

  /**
   * Query entity with all its connections
   */
  queryEntity(nameOrId: string): GraphQueryResult | null {
    const entity = this.getEntity(nameOrId);
    if (!entity) return null;

    const relationships = this.getRelationships(entity.id);
    const connections: GraphQueryResult['connections'] = [];

    for (const rel of relationships) {
      const isSource = rel.sourceId === entity.id;
      const connectedId = isSource ? rel.targetId : rel.sourceId;
      const connectedEntity = this.graph.entities[connectedId];

      if (connectedEntity) {
        connections.push({
          entity: connectedEntity,
          relationship: rel,
          direction: isSource ? 'outgoing' : 'incoming',
        });
      }
    }

    // Sort by relationship weight
    connections.sort((a, b) => b.relationship.weight - a.relationship.weight);

    return { entity, connections };
  }

  /**
   * Find shortest path between two entities
   */
  findPath(
    startId: string,
    endId: string,
    maxDepth: number = 5
  ): { path: Entity[]; relationships: Relationship[] } | null {
    const startEntity = this.getEntity(startId);
    const endEntity = this.getEntity(endId);

    if (!startEntity || !endEntity) return null;
    if (startEntity.id === endEntity.id) return { path: [startEntity], relationships: [] };

    // BFS for shortest path
    const visited = new Set<string>();
    const queue: { entityId: string; path: string[]; rels: string[] }[] = [
      { entityId: startEntity.id, path: [startEntity.id], rels: [] }
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.path.length > maxDepth) continue;
      if (visited.has(current.entityId)) continue;
      visited.add(current.entityId);

      const relationships = this.getRelationships(current.entityId, { minWeight: 0.2 });

      for (const rel of relationships) {
        const nextId = rel.sourceId === current.entityId ? rel.targetId : rel.sourceId;

        if (visited.has(nextId)) continue;

        const newPath = [...current.path, nextId];
        const newRels = [...current.rels, rel.id];

        if (nextId === endEntity.id) {
          return {
            path: newPath.map(id => this.graph.entities[id]),
            relationships: newRels.map(id => this.graph.relationships[id]),
          };
        }

        queue.push({ entityId: nextId, path: newPath, rels: newRels });
      }
    }

    return null;
  }

  /**
   * Get entity neighborhood (N-hop neighbors)
   */
  getNeighborhood(entityId: string, hops: number = 2): Entity[] {
    const entity = this.getEntity(entityId);
    if (!entity) return [];

    const visited = new Set<string>();
    const toVisit = [entity.id];

    for (let i = 0; i < hops; i++) {
      const nextLevel: string[] = [];

      for (const id of toVisit) {
        if (visited.has(id)) continue;
        visited.add(id);

        const relationships = this.getRelationships(id, { minWeight: 0.2 });
        for (const rel of relationships) {
          const connectedId = rel.sourceId === id ? rel.targetId : rel.sourceId;
          if (!visited.has(connectedId)) {
            nextLevel.push(connectedId);
          }
        }
      }

      toVisit.length = 0;
      toVisit.push(...nextLevel);
    }

    // Add remaining entities from toVisit
    for (const id of toVisit) {
      visited.add(id);
    }

    // Remove the starting entity and return the rest
    visited.delete(entity.id);
    return Array.from(visited)
      .map(id => this.graph.entities[id])
      .filter(Boolean)
      .sort((a, b) => b.occurrenceCount - a.occurrenceCount);
  }

  // ============================================================
  // Observation Integration
  // ============================================================

  /**
   * Extract entities and relationships from an observation
   */
  processObservation(observation: Observation): {
    entities: Entity[];
    relationships: Relationship[];
  } {
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    // Extract raw entities from text
    const text = `${observation.title} ${observation.narrative || ''}`;
    const rawEntities = extractEntities(text);

    // Add explicit concepts
    const concepts = observation.concepts || [];
    const allEntityNames = [...new Set([...rawEntities, ...concepts])];

    // Create entities
    for (const name of allEntityNames) {
      const entity = this.addEntity(name);
      entities.push(entity);
    }

    // Add file entities
    const filesRead = observation.files_read || [];
    const filesModified = observation.files_modified || [];

    for (const file of filesRead) {
      const entity = this.addEntity(file, { type: 'file' });
      entities.push(entity);
    }

    for (const file of filesModified) {
      const entity = this.addEntity(file, { type: 'file' });
      entities.push(entity);
    }

    // Create co-occurrence relationships between entities in same observation
    const evidence = `Observation #${observation.id}: ${observation.title}`;

    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const rel = this.addRelationship(entities[i], entities[j], 'co_occurs', evidence);
        relationships.push(rel);
      }
    }

    // Special relationships based on observation type
    if (observation.type === 'bugfix' && filesModified.length > 0) {
      // Files were modified to fix something
      const conceptEntities = entities.filter(e => e.type === 'concept' || e.type === 'unknown');
      const fileEntities = entities.filter(e => e.type === 'file');

      for (const concept of conceptEntities) {
        for (const file of fileEntities) {
          this.addRelationship(concept, file, 'fixed_by', evidence);
        }
      }
    }

    if (observation.type === 'feature' && filesModified.length > 0) {
      // New feature created files
      const conceptEntities = entities.filter(e => e.type === 'concept' || e.type === 'class' || e.type === 'function');
      const fileEntities = entities.filter(e => e.type === 'file');

      for (const concept of conceptEntities) {
        for (const file of fileEntities) {
          this.addRelationship(concept, file, 'implements', evidence);
        }
      }
    }

    this.dirty = true;
    return { entities, relationships };
  }

  /**
   * Sync graph with recent HutchMem observations
   */
  async syncFromHutchMem(options?: { limit?: number; types?: string[] }): Promise<number> {
    const bridge = getHutchMem();

    if (!bridge.isAvailable()) {
      await bridge.refreshAvailability();
    }

    if (!bridge.isAvailable()) {
      console.log('[EntityGraph] HutchMem not available for sync');
      return 0;
    }

    const result = await bridge.search('', {
      types: options?.types,
      limit: options?.limit || 100,
    });

    let processed = 0;
    for (const obs of result.observations) {
      this.processObservation(obs);
      processed++;
    }

    this.save();
    return processed;
  }

  // ============================================================
  // Statistics
  // ============================================================

  getStats(): {
    totalEntities: number;
    totalRelationships: number;
    entitiesByType: Record<EntityType, number>;
    relationshipsByType: Record<RelationType, number>;
    topEntities: Entity[];
  } {
    const entitiesByType: Record<string, number> = {};
    const relationshipsByType: Record<string, number> = {};

    for (const entity of Object.values(this.graph.entities)) {
      entitiesByType[entity.type] = (entitiesByType[entity.type] || 0) + 1;
    }

    for (const rel of Object.values(this.graph.relationships)) {
      relationshipsByType[rel.type] = (relationshipsByType[rel.type] || 0) + 1;
    }

    const topEntities = Object.values(this.graph.entities)
      .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
      .slice(0, 10);

    return {
      totalEntities: Object.keys(this.graph.entities).length,
      totalRelationships: Object.keys(this.graph.relationships).length,
      entitiesByType: entitiesByType as Record<EntityType, number>,
      relationshipsByType: relationshipsByType as Record<RelationType, number>,
      topEntities,
    };
  }
}

// ============================================================
// Singleton Instance
// ============================================================

let instance: EntityGraphManager | null = null;

export function getEntityGraph(): EntityGraphManager {
  if (!instance) {
    instance = new EntityGraphManager();
  }
  return instance;
}
