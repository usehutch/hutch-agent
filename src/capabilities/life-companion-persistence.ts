/**
 * Life Companion Persistence Layer
 *
 * Dual-write architecture:
 * 1. Structured tables → Fast queries ("show overdue reminders")
 * 2. Observations → Full context preservation ("what was I thinking?")
 *
 * Every life companion action creates both:
 * - A row in the structured table for efficient querying
 * - An observation for narrative memory and deep dives
 */

import { getHutchMem } from '../memory/bridge.js';

// ============================================================
// Configuration
// ============================================================

const HUTCHMEM_API = process.env.HUTCHMEM_API_URL || 'http://localhost:37777';
const PROJECT = process.env.HUTCHMEM_PROJECT || 'personal';

// Auth token loader (cached)
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
    // Silently fail - will make unauthenticated requests
  }
  return null;
}

// ============================================================
// Types
// ============================================================

export interface PersistenceResult {
  success: boolean;
  structuredId?: string;
  observationId?: number;
  error?: string;
}

export interface ReminderRecord {
  id: string;
  content: string;
  context?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'snoozed' | 'completed' | 'cancelled';
  dueAt?: Date;
  recurring?: {
    frequency: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval?: number;
    daysOfWeek?: number[];
    dayOfMonth?: number;
    endDate?: Date;
  };
  tags: string[];
  createdAt: Date;
}

export interface HabitRecord {
  id: string;
  name: string;
  description?: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  targetPerPeriod: number;
  currentStreak: number;
  longestStreak: number;
  category: string;
  active: boolean;
  createdAt: Date;
}

export interface HabitCompletionRecord {
  habitId: string;
  habitName: string;
  date: string;
  count: number;
  notes?: string;
  mood?: string;
}

export interface GoalRecord {
  id: string;
  area: 'health' | 'learning' | 'career' | 'relationships' | 'finance' | 'creativity' | 'mindfulness' | 'custom';
  title: string;
  description: string;
  targetDate?: Date;
  progress: number;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  milestones: string[];
  createdAt: Date;
}

export interface JournalRecord {
  id: string;
  type: 'daily' | 'weekly' | 'reflection' | 'gratitude' | 'freeform';
  content: string;
  mood?: string;
  highlights?: string[];
  challenges?: string[];
  learnings?: string[];
  tags: string[];
  createdAt: Date;
}

export interface LifeAreaRecord {
  name: string;
  currentScore: number;
  targetScore: number;
  notes?: string;
}

export interface WeeklyReviewRecord {
  weekStart: Date;
  accomplishments: string[];
  challenges: string[];
  lessonsLearned: string[];
  gratitude: string[];
  nextWeekPriorities: string[];
  overallRating: number;
  notes?: string;
}

// ============================================================
// API Helper
// ============================================================

async function apiCall<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: unknown
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const authToken = await getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${HUTCHMEM_API}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    const data = await response.json() as T;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ============================================================
// Observation Creation
// ============================================================

/**
 * Create an observation for a life companion action.
 * This preserves the full context for deep dives.
 */
async function createObservation(params: {
  type: 'reminder' | 'habit' | 'goal' | 'journal' | 'life_review';
  title: string;
  narrative: string;
  facts?: string[];
  concepts?: string[];
}): Promise<{ success: boolean; observationId?: number }> {
  const hutchMem = getHutchMem();

  // Use the bridge's record method
  const success = await hutchMem.record({
    type: params.type as string, // Life companion types (validated at HutchMem layer)
    title: params.title,
    narrative: params.narrative,
  });

  return { success };
}

// ============================================================
// Reminder Persistence
// ============================================================

export class ReminderPersistence {
  /**
   * Create a new reminder with dual-write
   */
  async create(reminder: ReminderRecord): Promise<PersistenceResult> {
    const now = Date.now();

    // 1. Create observation (full context for deep dive)
    const obsResult = await createObservation({
      type: 'reminder',
      title: `Reminder: ${reminder.content.slice(0, 50)}${reminder.content.length > 50 ? '...' : ''}`,
      narrative: this.buildReminderNarrative(reminder, 'created'),
      facts: [
        `Priority: ${reminder.priority}`,
        reminder.dueAt ? `Due: ${reminder.dueAt.toISOString()}` : 'No due date',
        reminder.recurring ? `Recurring: ${reminder.recurring.frequency}` : 'One-time',
      ],
      concepts: ['reminder', reminder.priority, ...reminder.tags],
    });

    // 2. Write to structured table
    const structuredResult = await apiCall('/api/life/reminders', 'POST', {
      id: reminder.id,
      project: PROJECT,
      content: reminder.content,
      context: reminder.context,
      priority: reminder.priority,
      status: reminder.status,
      due_at_epoch: reminder.dueAt?.getTime(),
      recurring_frequency: reminder.recurring?.frequency,
      recurring_interval: reminder.recurring?.interval,
      recurring_days_of_week: reminder.recurring?.daysOfWeek ? JSON.stringify(reminder.recurring.daysOfWeek) : null,
      recurring_day_of_month: reminder.recurring?.dayOfMonth,
      recurring_end_epoch: reminder.recurring?.endDate?.getTime(),
      tags: JSON.stringify(reminder.tags),
      observation_id: obsResult.observationId,
      created_at_epoch: now,
      updated_at_epoch: now,
    });

    return {
      success: obsResult.success || structuredResult.success,
      structuredId: reminder.id,
      observationId: obsResult.observationId,
      error: structuredResult.error,
    };
  }

  /**
   * Complete a reminder
   */
  async complete(reminderId: string, reminderContent: string): Promise<PersistenceResult> {
    // Create observation for completion
    await createObservation({
      type: 'reminder',
      title: `Completed: ${reminderContent.slice(0, 50)}`,
      narrative: `Completed reminder: "${reminderContent}"\n\nThis task is now done.`,
      concepts: ['reminder', 'completed'],
    });

    // Update structured table
    const result = await apiCall(`/api/life/reminders/${reminderId}`, 'PUT', {
      status: 'completed',
      completed_at_epoch: Date.now(),
      updated_at_epoch: Date.now(),
    });

    return { success: result.success, error: result.error };
  }

  /**
   * Get overdue reminders
   */
  async getOverdue(): Promise<ReminderRecord[]> {
    const result = await apiCall<{ reminders: ReminderRecord[] }>(
      `/api/life/reminders?status=pending&overdue=true&project=${PROJECT}`,
      'GET'
    );
    return result.data?.reminders || [];
  }

  /**
   * Get upcoming reminders
   */
  async getUpcoming(hours: number = 24): Promise<ReminderRecord[]> {
    const until = Date.now() + hours * 60 * 60 * 1000;
    const result = await apiCall<{ reminders: ReminderRecord[] }>(
      `/api/life/reminders?status=pending&until=${until}&project=${PROJECT}`,
      'GET'
    );
    return result.data?.reminders || [];
  }

  private buildReminderNarrative(reminder: ReminderRecord, action: string): string {
    let narrative = `${action === 'created' ? 'Set' : 'Updated'} a ${reminder.priority} priority reminder: "${reminder.content}"`;

    if (reminder.context) {
      narrative += `\n\nContext: ${reminder.context}`;
    }

    if (reminder.dueAt) {
      narrative += `\n\nDue: ${reminder.dueAt.toLocaleString()}`;
    }

    if (reminder.recurring) {
      narrative += `\n\nThis is a recurring reminder (${reminder.recurring.frequency})`;
    }

    if (reminder.tags.length > 0) {
      narrative += `\n\nTags: ${reminder.tags.join(', ')}`;
    }

    return narrative;
  }
}

// ============================================================
// Habit Persistence
// ============================================================

export class HabitPersistence {
  /**
   * Create a new habit
   */
  async create(habit: HabitRecord): Promise<PersistenceResult> {
    const now = Date.now();

    // Create observation
    const obsResult = await createObservation({
      type: 'habit',
      title: `New Habit: ${habit.name}`,
      narrative: this.buildHabitNarrative(habit),
      facts: [
        `Frequency: ${habit.frequency}`,
        `Target: ${habit.targetPerPeriod} per ${habit.frequency === 'daily' ? 'day' : 'week'}`,
        `Category: ${habit.category}`,
      ],
      concepts: ['habit', 'new', habit.category],
    });

    // Write to structured table
    const result = await apiCall('/api/life/habits', 'POST', {
      id: habit.id,
      project: PROJECT,
      name: habit.name,
      description: habit.description,
      frequency: habit.frequency,
      target_per_period: habit.targetPerPeriod,
      current_streak: 0,
      longest_streak: 0,
      category: habit.category,
      active: 1,
      observation_id: obsResult.observationId,
      created_at_epoch: now,
      updated_at_epoch: now,
    });

    return {
      success: obsResult.success || result.success,
      structuredId: habit.id,
      observationId: obsResult.observationId,
    };
  }

  /**
   * Log a habit completion
   */
  async logCompletion(completion: HabitCompletionRecord): Promise<PersistenceResult> {
    const now = Date.now();

    // Create detailed observation for the completion
    const obsResult = await createObservation({
      type: 'habit',
      title: `${completion.habitName}: Day ${completion.count}`,
      narrative: this.buildCompletionNarrative(completion),
      facts: completion.notes ? [`Notes: ${completion.notes}`] : [],
      concepts: ['habit', 'completion', completion.habitName.toLowerCase()],
    });

    // Write to habit_completions table
    const result = await apiCall('/api/life/habit-completions', 'POST', {
      habit_id: completion.habitId,
      project: PROJECT,
      date: completion.date,
      count: completion.count,
      notes: completion.notes,
      mood: completion.mood,
      observation_id: obsResult.observationId,
      created_at_epoch: now,
    });

    return {
      success: obsResult.success || result.success,
      observationId: obsResult.observationId,
    };
  }

  /**
   * Get habits due today
   */
  async getDueToday(): Promise<HabitRecord[]> {
    const result = await apiCall<{ habits: HabitRecord[] }>(
      `/api/life/habits?active=true&due_today=true&project=${PROJECT}`,
      'GET'
    );
    return result.data?.habits || [];
  }

  /**
   * Get habit statistics
   */
  async getStats(habitId: string): Promise<{
    completionRate: number;
    currentStreak: number;
    longestStreak: number;
    totalCompletions: number;
  } | null> {
    const result = await apiCall<{ stats: {
      completionRate: number;
      currentStreak: number;
      longestStreak: number;
      totalCompletions: number;
    } }>(`/api/life/habits/${habitId}/stats`, 'GET');
    return result.data?.stats || null;
  }

  private buildHabitNarrative(habit: HabitRecord): string {
    let narrative = `Starting to track a new habit: "${habit.name}"`;

    if (habit.description) {
      narrative += `\n\n${habit.description}`;
    }

    narrative += `\n\nGoal: Complete this ${habit.targetPerPeriod} time(s) ${habit.frequency === 'daily' ? 'every day' : 'every week'}.`;
    narrative += `\n\nCategory: ${habit.category}`;
    narrative += `\n\nThis habit has been added to daily tracking. Building consistent habits leads to lasting change.`;

    return narrative;
  }

  private buildCompletionNarrative(completion: HabitCompletionRecord): string {
    let narrative = `Completed habit: "${completion.habitName}" on ${completion.date}`;

    if (completion.notes) {
      narrative += `\n\nNotes: ${completion.notes}`;
    }

    if (completion.mood) {
      narrative += `\n\nMood: ${completion.mood}`;
    }

    return narrative;
  }
}

// ============================================================
// Goal Persistence
// ============================================================

export class GoalPersistence {
  /**
   * Create a new goal
   */
  async create(goal: GoalRecord): Promise<PersistenceResult> {
    const now = Date.now();

    // Create detailed observation
    const obsResult = await createObservation({
      type: 'goal',
      title: `New Goal: ${goal.title}`,
      narrative: this.buildGoalNarrative(goal),
      facts: [
        `Area: ${goal.area}`,
        `Progress: ${goal.progress}%`,
        goal.targetDate ? `Target: ${goal.targetDate.toISOString().split('T')[0]}` : 'No target date',
        `Milestones: ${goal.milestones.length}`,
      ],
      concepts: ['goal', goal.area, 'new'],
    });

    // Write to structured table
    const result = await apiCall('/api/life/goals', 'POST', {
      id: goal.id,
      project: PROJECT,
      area: goal.area,
      title: goal.title,
      description: goal.description,
      target_epoch: goal.targetDate?.getTime(),
      progress: goal.progress,
      status: goal.status,
      observation_id: obsResult.observationId,
      created_at_epoch: now,
      updated_at_epoch: now,
    });

    // Create milestones
    for (let i = 0; i < goal.milestones.length; i++) {
      await apiCall('/api/life/milestones', 'POST', {
        id: `${goal.id}_ms_${i}`,
        goal_id: goal.id,
        project: PROJECT,
        title: goal.milestones[i],
        sort_order: i,
        status: 'pending',
        created_at_epoch: now,
      });
    }

    return {
      success: obsResult.success || result.success,
      structuredId: goal.id,
      observationId: obsResult.observationId,
    };
  }

  /**
   * Update goal progress
   */
  async updateProgress(goalId: string, goalTitle: string, progress: number, reflection?: string): Promise<PersistenceResult> {
    // Create observation for progress update
    const obsResult = await createObservation({
      type: 'goal',
      title: `Progress: ${goalTitle} - ${progress}%`,
      narrative: `Updated progress on goal "${goalTitle}" to ${progress}%${reflection ? `\n\nReflection: ${reflection}` : ''}`,
      concepts: ['goal', 'progress'],
    });

    // Update structured table
    await apiCall(`/api/life/goals/${goalId}`, 'PUT', {
      progress,
      status: progress === 100 ? 'completed' : 'active',
      completed_at_epoch: progress === 100 ? Date.now() : null,
      updated_at_epoch: Date.now(),
    });

    // If there's a reflection, save it
    if (reflection) {
      await apiCall('/api/life/goal-reflections', 'POST', {
        goal_id: goalId,
        project: PROJECT,
        content: reflection,
        observation_id: obsResult.observationId,
        created_at_epoch: Date.now(),
      });
    }

    return { success: true, observationId: obsResult.observationId };
  }

  /**
   * Get active goals
   */
  async getActive(): Promise<GoalRecord[]> {
    const result = await apiCall<{ goals: GoalRecord[] }>(
      `/api/life/goals?status=active&project=${PROJECT}`,
      'GET'
    );
    return result.data?.goals || [];
  }

  private buildGoalNarrative(goal: GoalRecord): string {
    let narrative = `Setting a new goal in ${goal.area}: "${goal.title}"`;

    if (goal.description) {
      narrative += `\n\n${goal.description}`;
    }

    if (goal.targetDate) {
      narrative += `\n\nTarget completion: ${goal.targetDate.toLocaleDateString()}`;
    }

    if (goal.milestones.length > 0) {
      narrative += `\n\nMilestones:\n${goal.milestones.map((m, i) => `${i + 1}. ${m}`).join('\n')}`;
    }

    narrative += `\n\nThis goal has been added to track progress in the ${goal.area} area of life.`;

    return narrative;
  }
}

// ============================================================
// Journal Persistence
// ============================================================

export class JournalPersistence {
  /**
   * Create a journal entry
   */
  async create(journal: JournalRecord): Promise<PersistenceResult> {
    const now = Date.now();

    // Create observation with full content
    const obsResult = await createObservation({
      type: 'journal',
      title: this.buildJournalTitle(journal),
      narrative: this.buildJournalNarrative(journal),
      facts: [
        `Type: ${journal.type}`,
        journal.mood ? `Mood: ${journal.mood}` : '',
      ].filter(Boolean),
      concepts: ['journal', journal.type, ...(journal.tags || [])],
    });

    // Write to structured table
    const result = await apiCall('/api/life/journals', 'POST', {
      id: journal.id,
      project: PROJECT,
      type: journal.type,
      content: journal.content,
      mood: journal.mood,
      highlights: journal.highlights ? JSON.stringify(journal.highlights) : null,
      challenges: journal.challenges ? JSON.stringify(journal.challenges) : null,
      learnings: journal.learnings ? JSON.stringify(journal.learnings) : null,
      tags: JSON.stringify(journal.tags),
      observation_id: obsResult.observationId,
      created_at_epoch: now,
    });

    return {
      success: obsResult.success || result.success,
      structuredId: journal.id,
      observationId: obsResult.observationId,
    };
  }

  /**
   * Get recent journal entries
   */
  async getRecent(limit: number = 10): Promise<JournalRecord[]> {
    const result = await apiCall<{ journals: JournalRecord[] }>(
      `/api/life/journals?limit=${limit}&project=${PROJECT}`,
      'GET'
    );
    return result.data?.journals || [];
  }

  /**
   * Search journals
   */
  async search(query: string): Promise<JournalRecord[]> {
    const result = await apiCall<{ journals: JournalRecord[] }>(
      `/api/life/journals?search=${encodeURIComponent(query)}&project=${PROJECT}`,
      'GET'
    );
    return result.data?.journals || [];
  }

  private buildJournalTitle(journal: JournalRecord): string {
    const date = journal.createdAt.toLocaleDateString();
    switch (journal.type) {
      case 'daily':
        return `Daily Journal - ${date}`;
      case 'weekly':
        return `Weekly Reflection - ${date}`;
      case 'gratitude':
        return `Gratitude - ${date}`;
      case 'reflection':
        return `Reflection - ${date}`;
      default:
        return `Journal Entry - ${date}`;
    }
  }

  private buildJournalNarrative(journal: JournalRecord): string {
    let narrative = journal.content;

    if (journal.mood) {
      narrative = `Mood: ${journal.mood}\n\n${narrative}`;
    }

    if (journal.highlights && journal.highlights.length > 0) {
      narrative += `\n\n**Highlights:**\n${journal.highlights.map(h => `- ${h}`).join('\n')}`;
    }

    if (journal.challenges && journal.challenges.length > 0) {
      narrative += `\n\n**Challenges:**\n${journal.challenges.map(c => `- ${c}`).join('\n')}`;
    }

    if (journal.learnings && journal.learnings.length > 0) {
      narrative += `\n\n**Learnings:**\n${journal.learnings.map(l => `- ${l}`).join('\n')}`;
    }

    return narrative;
  }
}

// ============================================================
// Life Area Persistence
// ============================================================

export class LifeAreaPersistence {
  /**
   * Update a life area score
   */
  async updateScore(area: LifeAreaRecord): Promise<PersistenceResult> {
    const now = Date.now();

    // Create observation for the update
    const obsResult = await createObservation({
      type: 'life_review',
      title: `Life Area: ${area.name} - ${area.currentScore}/10`,
      narrative: `Updated ${area.name} score to ${area.currentScore}/10 (target: ${area.targetScore}/10)${area.notes ? `\n\nNotes: ${area.notes}` : ''}`,
      concepts: ['life_area', area.name.toLowerCase()],
    });

    // Upsert to structured table
    const result = await apiCall('/api/life/life-areas', 'POST', {
      project: PROJECT,
      name: area.name,
      current_score: area.currentScore,
      target_score: area.targetScore,
      notes: area.notes,
      observation_id: obsResult.observationId,
      created_at_epoch: now,
      updated_at_epoch: now,
    });

    return { success: result.success, observationId: obsResult.observationId };
  }

  /**
   * Get all life areas (wheel of life)
   */
  async getAll(): Promise<LifeAreaRecord[]> {
    const result = await apiCall<{ areas: LifeAreaRecord[] }>(
      `/api/life/life-areas?project=${PROJECT}`,
      'GET'
    );
    return result.data?.areas || [];
  }
}

// ============================================================
// Weekly Review Persistence
// ============================================================

export class WeeklyReviewPersistence {
  /**
   * Create a weekly review
   */
  async create(review: WeeklyReviewRecord): Promise<PersistenceResult> {
    const now = Date.now();
    const weekEnd = new Date(review.weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    // Create comprehensive observation
    const obsResult = await createObservation({
      type: 'life_review',
      title: `Weekly Review: ${review.weekStart.toLocaleDateString()}`,
      narrative: this.buildReviewNarrative(review),
      facts: [
        `Overall Rating: ${review.overallRating}/10`,
        `Accomplishments: ${review.accomplishments.length}`,
        `Challenges: ${review.challenges.length}`,
      ],
      concepts: ['weekly_review', 'reflection'],
    });

    // Write to structured table
    const result = await apiCall('/api/life/weekly-reviews', 'POST', {
      project: PROJECT,
      week_start_epoch: review.weekStart.getTime(),
      week_end_epoch: weekEnd.getTime(),
      accomplishments: JSON.stringify(review.accomplishments),
      challenges: JSON.stringify(review.challenges),
      lessons_learned: JSON.stringify(review.lessonsLearned),
      gratitude: JSON.stringify(review.gratitude),
      next_week_priorities: JSON.stringify(review.nextWeekPriorities),
      overall_rating: review.overallRating,
      notes: review.notes,
      observation_id: obsResult.observationId,
      created_at_epoch: now,
    });

    return { success: result.success, observationId: obsResult.observationId };
  }

  /**
   * Get recent weekly reviews
   */
  async getRecent(limit: number = 4): Promise<WeeklyReviewRecord[]> {
    const result = await apiCall<{ reviews: WeeklyReviewRecord[] }>(
      `/api/life/weekly-reviews?limit=${limit}&project=${PROJECT}`,
      'GET'
    );
    return result.data?.reviews || [];
  }

  private buildReviewNarrative(review: WeeklyReviewRecord): string {
    let narrative = `Weekly Review for week of ${review.weekStart.toLocaleDateString()}\n`;
    narrative += `Overall Rating: ${review.overallRating}/10\n\n`;

    if (review.accomplishments.length > 0) {
      narrative += `**Accomplishments:**\n${review.accomplishments.map(a => `- ${a}`).join('\n')}\n\n`;
    }

    if (review.challenges.length > 0) {
      narrative += `**Challenges:**\n${review.challenges.map(c => `- ${c}`).join('\n')}\n\n`;
    }

    if (review.lessonsLearned.length > 0) {
      narrative += `**Lessons Learned:**\n${review.lessonsLearned.map(l => `- ${l}`).join('\n')}\n\n`;
    }

    if (review.gratitude.length > 0) {
      narrative += `**Gratitude:**\n${review.gratitude.map(g => `- ${g}`).join('\n')}\n\n`;
    }

    if (review.nextWeekPriorities.length > 0) {
      narrative += `**Next Week Priorities:**\n${review.nextWeekPriorities.map(p => `- ${p}`).join('\n')}\n\n`;
    }

    if (review.notes) {
      narrative += `**Notes:**\n${review.notes}`;
    }

    return narrative;
  }
}

// ============================================================
// Factory Functions
// ============================================================

export function createReminderPersistence(): ReminderPersistence {
  return new ReminderPersistence();
}

export function createHabitPersistence(): HabitPersistence {
  return new HabitPersistence();
}

export function createGoalPersistence(): GoalPersistence {
  return new GoalPersistence();
}

export function createJournalPersistence(): JournalPersistence {
  return new JournalPersistence();
}

export function createLifeAreaPersistence(): LifeAreaPersistence {
  return new LifeAreaPersistence();
}

export function createWeeklyReviewPersistence(): WeeklyReviewPersistence {
  return new WeeklyReviewPersistence();
}
