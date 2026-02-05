/**
 * User Model
 *
 * Tracks learned preferences, patterns, and adaptations for personalization.
 * This builds a rich understanding of the user over time through:
 *
 * 1. Communication preferences (style, length, formality)
 * 2. Domain expertise levels
 * 3. Behavioral patterns (active hours, common tasks)
 * 4. Correction history (what the user fixes)
 * 5. Tool preferences
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { AGENT_DIR, HUTCHMEM_API_URL } from '../core/config.js';

const USER_MODEL_FILE = join(AGENT_DIR, 'user-model.json');

// ============================================================
// Types
// ============================================================

export interface CommunicationPreferences {
  /** Preferred response length */
  responseLength: 'brief' | 'moderate' | 'detailed' | 'adaptive';
  /** Formality level 0-1 (0 = casual, 1 = formal) */
  formalityLevel: number;
  /** Technical depth 0-1 (0 = high-level, 1 = deep technical) */
  technicalDepth: number;
  /** Prefers code examples */
  likesCodeExamples: boolean;
  /** Prefers step-by-step explanations */
  likesStepByStep: boolean;
  /** Uses emojis */
  usesEmojis: boolean;
}

export interface DomainExpertise {
  domain: string;
  proficiency: number; // 0-1
  lastUpdated: number;
  evidenceCount: number;
}

export interface TaskPattern {
  type: string;
  frequency: number;
  avgDurationMs: number;
  preferredApproach: string | null;
  successRate: number;
  lastOccurrence: number;
}

export interface Correction {
  timestamp: number;
  original: string;
  corrected: string;
  category: 'style' | 'accuracy' | 'approach' | 'other';
}

export interface ToolPreference {
  tool: string;
  usageCount: number;
  successRate: number;
  preferredFor: string[];
}

export interface ActiveHourPattern {
  hour: number; // 0-23
  dayOfWeek: number; // 0-6
  activityCount: number;
}

export interface UserModel {
  /** Model version for migrations */
  version: number;

  /** Last updated timestamp */
  lastUpdated: number;

  /** Communication style preferences */
  communication: CommunicationPreferences;

  /** Domain expertise levels */
  expertise: DomainExpertise[];

  /** Common task patterns */
  taskPatterns: TaskPattern[];

  /** Correction history (recent only) */
  corrections: Correction[];

  /** Tool usage preferences */
  toolPreferences: ToolPreference[];

  /** Active hours patterns */
  activeHours: ActiveHourPattern[];

  /** Custom user notes (explicit preferences) */
  notes: string[];

  /** Inferred traits */
  traits: {
    /** Prefers proactive suggestions */
    likesProactiveSuggestions: boolean;
    /** Tolerates errors (vs wants perfection) */
    errorTolerance: number;
    /** Speed vs thoroughness preference */
    speedVsThoroughness: number; // 0 = speed, 1 = thoroughness
    /** Likes to understand why, not just how */
    wantsExplanations: boolean;
  };
}

// ============================================================
// Default Model
// ============================================================

const DEFAULT_MODEL: UserModel = {
  version: 1,
  lastUpdated: Date.now(),
  communication: {
    responseLength: 'adaptive',
    formalityLevel: 0.3,
    technicalDepth: 0.7,
    likesCodeExamples: true,
    likesStepByStep: false,
    usesEmojis: false,
  },
  expertise: [],
  taskPatterns: [],
  corrections: [],
  toolPreferences: [],
  activeHours: [],
  notes: [],
  traits: {
    likesProactiveSuggestions: true,
    errorTolerance: 0.5,
    speedVsThoroughness: 0.6,
    wantsExplanations: true,
  },
};

// ============================================================
// User Model Manager
// ============================================================

export class UserModelManager {
  private model: UserModel;
  private dirty: boolean = false;

  constructor() {
    this.model = this.load();
  }

  /**
   * Load model from disk or create default
   */
  private load(): UserModel {
    try {
      if (existsSync(USER_MODEL_FILE)) {
        const data = readFileSync(USER_MODEL_FILE, 'utf-8');
        const loaded = JSON.parse(data) as UserModel;
        // Merge with defaults for any missing fields
        return { ...DEFAULT_MODEL, ...loaded };
      }
    } catch (err) {
      console.log(`[UserModel] Failed to load: ${(err as Error).message}`);
    }
    return { ...DEFAULT_MODEL };
  }

  /**
   * Save model to disk
   */
  save(): void {
    try {
      mkdirSync(AGENT_DIR, { recursive: true });
      this.model.lastUpdated = Date.now();
      writeFileSync(USER_MODEL_FILE, JSON.stringify(this.model, null, 2));
      this.dirty = false;
    } catch (err) {
      console.log(`[UserModel] Failed to save: ${(err as Error).message}`);
    }
  }

  /**
   * Get the current model
   */
  getModel(): UserModel {
    return this.model;
  }

  // ============================================================
  // Recording Methods
  // ============================================================

  /**
   * Record activity at current time (for active hours tracking)
   */
  recordActivity(): void {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();

    const existing = this.model.activeHours.find(
      p => p.hour === hour && p.dayOfWeek === dayOfWeek
    );

    if (existing) {
      existing.activityCount++;
    } else {
      this.model.activeHours.push({ hour, dayOfWeek, activityCount: 1 });
    }

    this.dirty = true;
  }

  /**
   * Record a task execution
   */
  recordTask(
    taskType: string,
    durationMs: number,
    success: boolean,
    approach?: string
  ): void {
    const existing = this.model.taskPatterns.find(p => p.type === taskType);

    if (existing) {
      // Update running averages
      const total = existing.frequency + 1;
      existing.avgDurationMs = (existing.avgDurationMs * existing.frequency + durationMs) / total;
      existing.successRate = (existing.successRate * existing.frequency + (success ? 1 : 0)) / total;
      existing.frequency = total;
      existing.lastOccurrence = Date.now();
      if (approach && success) {
        existing.preferredApproach = approach;
      }
    } else {
      this.model.taskPatterns.push({
        type: taskType,
        frequency: 1,
        avgDurationMs: durationMs,
        preferredApproach: approach || null,
        successRate: success ? 1 : 0,
        lastOccurrence: Date.now(),
      });
    }

    this.dirty = true;
  }

  /**
   * Record tool usage
   */
  recordToolUsage(tool: string, success: boolean, context?: string): void {
    const existing = this.model.toolPreferences.find(p => p.tool === tool);

    if (existing) {
      const total = existing.usageCount + 1;
      existing.successRate = (existing.successRate * existing.usageCount + (success ? 1 : 0)) / total;
      existing.usageCount = total;
      if (context && !existing.preferredFor.includes(context)) {
        existing.preferredFor.push(context);
        // Keep only last 5 contexts
        if (existing.preferredFor.length > 5) {
          existing.preferredFor.shift();
        }
      }
    } else {
      this.model.toolPreferences.push({
        tool,
        usageCount: 1,
        successRate: success ? 1 : 0,
        preferredFor: context ? [context] : [],
      });
    }

    this.dirty = true;
  }

  /**
   * Record a correction (when user fixes something)
   */
  recordCorrection(original: string, corrected: string, category: Correction['category']): void {
    this.model.corrections.push({
      timestamp: Date.now(),
      original: original.slice(0, 500),
      corrected: corrected.slice(0, 500),
      category,
    });

    // Keep only last 50 corrections
    if (this.model.corrections.length > 50) {
      this.model.corrections.shift();
    }

    // Adjust traits based on correction type
    if (category === 'style') {
      // User cares about style - increase thoroughness
      this.model.traits.speedVsThoroughness = Math.min(1, this.model.traits.speedVsThoroughness + 0.05);
    } else if (category === 'accuracy') {
      // User found error - decrease error tolerance
      this.model.traits.errorTolerance = Math.max(0, this.model.traits.errorTolerance - 0.05);
    }

    this.dirty = true;
  }

  /**
   * Record domain expertise evidence
   */
  recordExpertise(domain: string, demonstratedProficiency: number): void {
    const existing = this.model.expertise.find(e => e.domain === domain);

    if (existing) {
      // Weighted average toward demonstrated proficiency
      existing.proficiency = existing.proficiency * 0.8 + demonstratedProficiency * 0.2;
      existing.lastUpdated = Date.now();
      existing.evidenceCount++;
    } else {
      this.model.expertise.push({
        domain,
        proficiency: demonstratedProficiency,
        lastUpdated: Date.now(),
        evidenceCount: 1,
      });
    }

    this.dirty = true;
  }

  /**
   * Add explicit user note
   */
  addNote(note: string): void {
    if (!this.model.notes.includes(note)) {
      this.model.notes.push(note);
      this.dirty = true;
    }
  }

  // ============================================================
  // Query Methods
  // ============================================================

  /**
   * Get user's expertise level in a domain
   */
  getExpertise(domain: string): number {
    const expertise = this.model.expertise.find(e =>
      e.domain.toLowerCase().includes(domain.toLowerCase()) ||
      domain.toLowerCase().includes(e.domain.toLowerCase())
    );
    return expertise?.proficiency ?? 0.5; // Default to medium
  }

  /**
   * Get preferred approach for a task type
   */
  getPreferredApproach(taskType: string): string | null {
    const pattern = this.model.taskPatterns.find(p =>
      p.type.toLowerCase().includes(taskType.toLowerCase())
    );
    return pattern?.preferredApproach ?? null;
  }

  /**
   * Check if now is an active time for the user
   */
  isActiveTime(): boolean {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();

    const pattern = this.model.activeHours.find(
      p => p.hour === hour && p.dayOfWeek === dayOfWeek
    );

    // If we have data, check if this is an active time
    if (this.model.activeHours.length > 10) {
      const avgActivity = this.model.activeHours.reduce((sum, p) => sum + p.activityCount, 0) /
        this.model.activeHours.length;
      return (pattern?.activityCount ?? 0) >= avgActivity;
    }

    // Not enough data - assume active during work hours
    return hour >= 9 && hour <= 18;
  }

  /**
   * Get recent correction patterns
   */
  getCorrectionPatterns(): { category: string; count: number }[] {
    const counts = new Map<string, number>();

    for (const correction of this.model.corrections.slice(-20)) {
      counts.set(correction.category, (counts.get(correction.category) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get communication guidelines for current context
   */
  getCommunicationGuidelines(): string[] {
    const guidelines: string[] = [];
    const { communication, traits } = this.model;

    if (communication.responseLength === 'brief') {
      guidelines.push('Keep responses concise and to the point');
    } else if (communication.responseLength === 'detailed') {
      guidelines.push('Provide comprehensive explanations');
    }

    if (communication.technicalDepth > 0.7) {
      guidelines.push('Use technical terminology freely');
    } else if (communication.technicalDepth < 0.3) {
      guidelines.push('Explain technical concepts in simple terms');
    }

    if (communication.likesCodeExamples) {
      guidelines.push('Include code examples when relevant');
    }

    if (traits.wantsExplanations) {
      guidelines.push('Explain the reasoning behind decisions');
    }

    if (!communication.usesEmojis) {
      guidelines.push('Avoid using emojis');
    }

    return guidelines;
  }

  /**
   * Auto-save if dirty
   */
  autoSave(): void {
    if (this.dirty) {
      this.save();
    }
  }
}

// ============================================================
// Singleton Instance
// ============================================================

let instance: UserModelManager | null = null;

export function getUserModel(): UserModelManager {
  if (!instance) {
    instance = new UserModelManager();
  }
  return instance;
}

/**
 * Sync user model with HutchMem personality observations
 */
export async function syncWithHutchMem(): Promise<void> {
  try {
    const model = getUserModel();
    const authToken = await getAuthToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    // Fetch personality observations
    const response = await fetch(`${HUTCHMEM_API_URL}/api/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: '',
        type: 'personality',
        limit: 20,
      }),
    });

    if (!response.ok) return;

    const observations = await response.json() as Array<{
      title: string;
      subtitle?: string;
      narrative?: string;
    }>;

    // Extract preferences from personality observations
    for (const obs of observations) {
      const text = `${obs.title} ${obs.subtitle || ''} ${obs.narrative || ''}`.toLowerCase();

      // Check for communication preferences
      if (text.includes('brief') || text.includes('concise')) {
        model.getModel().communication.responseLength = 'brief';
      } else if (text.includes('detailed') || text.includes('comprehensive')) {
        model.getModel().communication.responseLength = 'detailed';
      }

      if (text.includes('technical') || text.includes('deep dive')) {
        model.getModel().communication.technicalDepth = Math.min(1, model.getModel().communication.technicalDepth + 0.1);
      }

      if (text.includes('emoji')) {
        model.getModel().communication.usesEmojis = text.includes('uses emoji') || text.includes('likes emoji');
      }

      // Add as note if explicit preference
      if (text.includes('prefers') || text.includes('wants') || text.includes('likes')) {
        model.addNote(obs.title);
      }
    }

    model.save();
  } catch (err) {
    console.log(`[UserModel] Sync failed: ${(err as Error).message}`);
  }
}

// Auth helper
let cachedAuthToken: string | null = null;

async function getAuthToken(): Promise<string | null> {
  if (cachedAuthToken) return cachedAuthToken;

  try {
    const tokenPath = `${process.env.HOME}/.hutch-mem/.auth-token`;
    const file = Bun.file(tokenPath);
    if (await file.exists()) {
      cachedAuthToken = (await file.text()).trim();
      return cachedAuthToken;
    }
  } catch {
    // Silently fail
  }
  return null;
}
