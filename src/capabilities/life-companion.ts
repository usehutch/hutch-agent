/**
 * Hutch Agent Life Companion Capabilities
 *
 * This module provides helpers for personal life management:
 * - Reminders and notifications
 * - Habit and growth tracking
 * - Life journaling and reflection
 * - Goal progress monitoring
 *
 * Designed to run locally as a persistent companion.
 *
 * PERSISTENCE: All data is persisted via dual-write:
 * 1. Structured tables → Fast queries
 * 2. Observations → Full context for deep dives
 */

import {
  ReminderPersistence,
  HabitPersistence,
  GoalPersistence,
  JournalPersistence,
  LifeAreaPersistence,
  WeeklyReviewPersistence,
  createReminderPersistence,
  createHabitPersistence,
  createGoalPersistence,
  createJournalPersistence,
  createLifeAreaPersistence,
  createWeeklyReviewPersistence,
} from './life-companion-persistence.js';

// ============================================================
// Types & Interfaces
// ============================================================

export interface Reminder {
  id: string;
  content: string;
  context?: string;
  createdAt: Date;
  dueAt?: Date;
  recurring?: RecurringPattern;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'snoozed' | 'completed' | 'cancelled';
  tags: string[];
}

export interface RecurringPattern {
  frequency: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number; // every N days/weeks/etc
  daysOfWeek?: number[]; // 0=Sunday, 1=Monday, etc
  dayOfMonth?: number;
  endDate?: Date;
}

export interface Habit {
  id: string;
  name: string;
  description?: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  targetPerPeriod: number;
  currentStreak: number;
  longestStreak: number;
  completions: HabitCompletion[];
  createdAt: Date;
  category: string;
  active: boolean;
}

export interface HabitCompletion {
  date: string; // YYYY-MM-DD
  count: number;
  notes?: string;
}

export interface GrowthGoal {
  id: string;
  area: 'health' | 'learning' | 'career' | 'relationships' | 'finance' | 'creativity' | 'mindfulness' | 'custom';
  title: string;
  description: string;
  targetDate?: Date;
  milestones: Milestone[];
  progress: number; // 0-100
  reflections: Reflection[];
  status: 'active' | 'paused' | 'completed' | 'abandoned';
}

export interface Milestone {
  id: string;
  title: string;
  targetDate?: Date;
  completedAt?: Date;
  status: 'pending' | 'completed' | 'skipped';
}

export interface Reflection {
  date: Date;
  content: string;
  mood?: 'great' | 'good' | 'okay' | 'struggling' | 'difficult';
  insights: string[];
  gratitude?: string[];
}

export interface JournalEntry {
  id: string;
  date: Date;
  type: 'daily' | 'weekly' | 'reflection' | 'gratitude' | 'freeform';
  content: string;
  mood?: string;
  highlights?: string[];
  challenges?: string[];
  learnings?: string[];
  tags: string[];
}

export interface LifeArea {
  name: string;
  currentScore: number; // 1-10
  targetScore: number;
  lastUpdated: Date;
  notes: string;
  activeGoals: string[]; // Goal IDs
}

export interface WeeklyReview {
  weekStart: Date;
  weekEnd: Date;
  accomplishments: string[];
  challenges: string[];
  lessonsLearned: string[];
  gratitude: string[];
  nextWeekPriorities: string[];
  overallRating: number; // 1-10
  notes: string;
}

// ============================================================
// ReminderHelper - Never forget anything
// ============================================================

export class ReminderHelper {
  private reminders: Reminder[] = [];
  private persistence: ReminderPersistence;

  constructor() {
    this.persistence = createReminderPersistence();
  }

  /**
   * Create a new reminder (persisted to HutchMem)
   */
  async createReminder(params: {
    content: string;
    context?: string;
    dueAt?: Date;
    recurring?: RecurringPattern;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    tags?: string[];
  }): Promise<Reminder> {
    const reminder: Reminder = {
      id: `rem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content: params.content,
      context: params.context,
      createdAt: new Date(),
      dueAt: params.dueAt,
      recurring: params.recurring,
      priority: params.priority || 'medium',
      status: 'pending',
      tags: params.tags || [],
    };

    // Add to in-memory cache
    this.reminders.push(reminder);

    // Persist to HutchMem (dual-write: structured + observation)
    await this.persistence.create({
      id: reminder.id,
      content: reminder.content,
      context: reminder.context,
      priority: reminder.priority,
      status: reminder.status,
      dueAt: reminder.dueAt,
      recurring: reminder.recurring,
      tags: reminder.tags,
      createdAt: reminder.createdAt,
    });

    return reminder;
  }

  /**
   * Get upcoming reminders
   */
  getUpcoming(hours: number = 24): Reminder[] {
    const now = new Date();
    const cutoff = new Date(now.getTime() + hours * 60 * 60 * 1000);

    return this.reminders
      .filter(r => r.status === 'pending' && r.dueAt && r.dueAt <= cutoff)
      .sort((a, b) => (a.dueAt?.getTime() || 0) - (b.dueAt?.getTime() || 0));
  }

  /**
   * Get overdue reminders
   */
  getOverdue(): Reminder[] {
    const now = new Date();
    return this.reminders
      .filter(r => r.status === 'pending' && r.dueAt && r.dueAt < now)
      .sort((a, b) => (a.dueAt?.getTime() || 0) - (b.dueAt?.getTime() || 0));
  }

  /**
   * Complete a reminder (persisted to HutchMem)
   */
  async complete(id: string): Promise<Reminder | null> {
    const reminder = this.reminders.find(r => r.id === id);
    if (reminder) {
      reminder.status = 'completed';

      // Persist completion to HutchMem
      await this.persistence.complete(id, reminder.content);

      // If recurring, create next occurrence
      if (reminder.recurring) {
        await this.createNextOccurrence(reminder);
      }
    }
    return reminder || null;
  }

  /**
   * Snooze a reminder
   */
  snooze(id: string, untilDate: Date): Reminder | null {
    const reminder = this.reminders.find(r => r.id === id);
    if (reminder) {
      reminder.status = 'snoozed';
      reminder.dueAt = untilDate;
    }
    return reminder || null;
  }

  /**
   * Get prompt for setting up reminders
   */
  getReminderPrompt(task: string): string {
    return `I need to remember: "${task}"

Help me set this up properly:
1. When should I be reminded?
2. Is this a one-time or recurring thing?
3. What priority level makes sense?
4. Any context I should capture for when the reminder triggers?
5. Should this be linked to any other tasks or goals?`;
  }

  private async createNextOccurrence(reminder: Reminder): Promise<void> {
    if (!reminder.recurring || !reminder.dueAt) return;

    const nextDate = this.calculateNextDate(reminder.dueAt, reminder.recurring);
    if (nextDate && (!reminder.recurring.endDate || nextDate <= reminder.recurring.endDate)) {
      await this.createReminder({
        content: reminder.content,
        context: reminder.context,
        dueAt: nextDate,
        recurring: reminder.recurring,
        priority: reminder.priority,
        tags: reminder.tags,
      });
    }
  }

  private calculateNextDate(current: Date, pattern: RecurringPattern): Date {
    const next = new Date(current);

    switch (pattern.frequency) {
      case 'daily':
        next.setDate(next.getDate() + (pattern.interval || 1));
        break;
      case 'weekly':
        next.setDate(next.getDate() + 7 * (pattern.interval || 1));
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + (pattern.interval || 1));
        break;
      case 'yearly':
        next.setFullYear(next.getFullYear() + (pattern.interval || 1));
        break;
    }

    return next;
  }
}

// ============================================================
// HabitTracker - Build consistent habits
// ============================================================

export class HabitTracker {
  private habits: Habit[] = [];
  private persistence: HabitPersistence;

  constructor() {
    this.persistence = createHabitPersistence();
  }

  /**
   * Create a new habit to track (persisted to HutchMem)
   */
  async createHabit(params: {
    name: string;
    description?: string;
    frequency?: 'daily' | 'weekly' | 'monthly';
    targetPerPeriod?: number;
    category?: string;
  }): Promise<Habit> {
    const habit: Habit = {
      id: `hab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: params.name,
      description: params.description,
      frequency: params.frequency || 'daily',
      targetPerPeriod: params.targetPerPeriod || 1,
      currentStreak: 0,
      longestStreak: 0,
      completions: [],
      createdAt: new Date(),
      category: params.category || 'general',
      active: true,
    };

    // Add to in-memory cache
    this.habits.push(habit);

    // Persist to HutchMem
    await this.persistence.create({
      id: habit.id,
      name: habit.name,
      description: habit.description,
      frequency: habit.frequency,
      targetPerPeriod: habit.targetPerPeriod,
      currentStreak: habit.currentStreak,
      longestStreak: habit.longestStreak,
      category: habit.category,
      active: habit.active,
      createdAt: habit.createdAt,
    });

    return habit;
  }

  /**
   * Log a habit completion (persisted to HutchMem)
   */
  async logCompletion(habitId: string, notes?: string, mood?: string): Promise<Habit | null> {
    const habit = this.habits.find(h => h.id === habitId);
    if (!habit) return null;

    const today = new Date().toISOString().split('T')[0];
    const existingCompletion = habit.completions.find(c => c.date === today);

    let count = 1;
    if (existingCompletion) {
      existingCompletion.count++;
      count = existingCompletion.count;
      if (notes) existingCompletion.notes = notes;
    } else {
      habit.completions.push({ date: today, count: 1, notes });
    }

    // Update streak
    this.updateStreak(habit);

    // Persist completion to HutchMem
    await this.persistence.logCompletion({
      habitId: habit.id,
      habitName: habit.name,
      date: today,
      count,
      notes,
      mood,
    });

    return habit;
  }

  /**
   * Get habits due today
   */
  getDueToday(): Habit[] {
    const today = new Date().toISOString().split('T')[0];

    return this.habits.filter(h => {
      if (!h.active) return false;

      const todayCompletion = h.completions.find(c => c.date === today);
      const completedToday = todayCompletion?.count || 0;

      return completedToday < h.targetPerPeriod;
    });
  }

  /**
   * Get habit statistics
   */
  getStats(habitId: string): {
    completionRate: number;
    currentStreak: number;
    longestStreak: number;
    totalCompletions: number;
    averagePerDay: number;
  } | null {
    const habit = this.habits.find(h => h.id === habitId);
    if (!habit) return null;

    const totalDays = Math.ceil(
      (Date.now() - habit.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    const totalCompletions = habit.completions.reduce((sum, c) => sum + c.count, 0);
    const daysCompleted = habit.completions.length;

    return {
      completionRate: totalDays > 0 ? (daysCompleted / totalDays) * 100 : 0,
      currentStreak: habit.currentStreak,
      longestStreak: habit.longestStreak,
      totalCompletions,
      averagePerDay: totalDays > 0 ? totalCompletions / totalDays : 0,
    };
  }

  /**
   * Get prompt for habit check-in
   */
  getCheckInPrompt(): string {
    const dueHabits = this.getDueToday();

    if (dueHabits.length === 0) {
      return `Great job! All habits completed for today.

Let me know if you want to:
1. Review your habit streaks
2. Add a new habit to track
3. Reflect on your progress`;
    }

    return `Habits to complete today:

${dueHabits.map((h, i) => `${i + 1}. ${h.name} (${h.currentStreak} day streak)`).join('\n')}

Which ones have you done? Let's log your progress.`;
  }

  private updateStreak(habit: Habit): void {
    const completions = habit.completions
      .map(c => c.date)
      .sort()
      .reverse();

    if (completions.length === 0) {
      habit.currentStreak = 0;
      return;
    }

    let streak = 1;
    const today = new Date().toISOString().split('T')[0];

    // Check if completed today or yesterday
    if (completions[0] !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      if (completions[0] !== yesterday.toISOString().split('T')[0]) {
        habit.currentStreak = 0;
        return;
      }
    }

    // Count consecutive days
    for (let i = 1; i < completions.length; i++) {
      const current = new Date(completions[i - 1]);
      const prev = new Date(completions[i]);
      const diffDays = Math.round((current.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        streak++;
      } else {
        break;
      }
    }

    habit.currentStreak = streak;
    if (streak > habit.longestStreak) {
      habit.longestStreak = streak;
    }
  }
}

// ============================================================
// GrowthTracker - Personal development & goals
// ============================================================

export class GrowthTracker {
  private _goals: GrowthGoal[] = [];
  private _lifeAreas: LifeArea[] = [];
  private goalPersistence: GoalPersistence;
  private lifeAreaPersistence: LifeAreaPersistence;

  /**
   * Get all goals
   */
  get goals(): GrowthGoal[] {
    return this._goals;
  }

  /**
   * Get all life areas
   */
  get lifeAreas(): LifeArea[] {
    return this._lifeAreas;
  }

  constructor() {
    this.goalPersistence = createGoalPersistence();
    this.lifeAreaPersistence = createLifeAreaPersistence();

    // Initialize default life areas
    this._lifeAreas = [
      { name: 'Health & Fitness', currentScore: 5, targetScore: 8, lastUpdated: new Date(), notes: '', activeGoals: [] },
      { name: 'Career & Work', currentScore: 5, targetScore: 8, lastUpdated: new Date(), notes: '', activeGoals: [] },
      { name: 'Relationships', currentScore: 5, targetScore: 8, lastUpdated: new Date(), notes: '', activeGoals: [] },
      { name: 'Learning & Growth', currentScore: 5, targetScore: 8, lastUpdated: new Date(), notes: '', activeGoals: [] },
      { name: 'Finance', currentScore: 5, targetScore: 8, lastUpdated: new Date(), notes: '', activeGoals: [] },
      { name: 'Fun & Recreation', currentScore: 5, targetScore: 8, lastUpdated: new Date(), notes: '', activeGoals: [] },
      { name: 'Environment', currentScore: 5, targetScore: 8, lastUpdated: new Date(), notes: '', activeGoals: [] },
      { name: 'Mindfulness', currentScore: 5, targetScore: 8, lastUpdated: new Date(), notes: '', activeGoals: [] },
    ];
  }

  /**
   * Create a new growth goal (persisted to HutchMem)
   */
  async createGoal(params: {
    area: GrowthGoal['area'];
    title: string;
    description: string;
    targetDate?: Date;
    milestones?: string[];
  }): Promise<GrowthGoal> {
    const goal: GrowthGoal = {
      id: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      area: params.area,
      title: params.title,
      description: params.description,
      targetDate: params.targetDate,
      milestones: (params.milestones || []).map((m, i) => ({
        id: `ms_${i}`,
        title: m,
        status: 'pending' as const,
      })),
      progress: 0,
      reflections: [],
      status: 'active',
    };

    // Add to in-memory cache
    this._goals.push(goal);

    // Persist to HutchMem
    await this.goalPersistence.create({
      id: goal.id,
      area: goal.area,
      title: goal.title,
      description: goal.description,
      targetDate: goal.targetDate,
      progress: goal.progress,
      status: goal.status,
      milestones: goal.milestones.map(m => m.title),
      createdAt: new Date(),
    });

    return goal;
  }

  /**
   * Update progress on a goal (persisted to HutchMem)
   */
  async updateProgress(goalId: string, progress: number, reflection?: string): Promise<GrowthGoal | null> {
    const goal = this._goals.find(g => g.id === goalId);
    if (!goal) return null;

    goal.progress = Math.min(100, Math.max(0, progress));

    if (reflection) {
      goal.reflections.push({
        date: new Date(),
        content: reflection,
        insights: [],
      });
    }

    if (goal.progress === 100) {
      goal.status = 'completed';
    }

    // Persist to HutchMem
    await this.goalPersistence.updateProgress(goalId, goal.title, goal.progress, reflection);

    return goal;
  }

  /**
   * Complete a milestone
   */
  completeMilestone(goalId: string, milestoneId: string): GrowthGoal | null {
    const goal = this._goals.find(g => g.id === goalId);
    if (!goal) return null;

    const milestone = goal.milestones.find(m => m.id === milestoneId);
    if (milestone) {
      milestone.status = 'completed';
      milestone.completedAt = new Date();

      // Update overall progress based on milestones
      const completedCount = goal.milestones.filter(m => m.status === 'completed').length;
      goal.progress = Math.round((completedCount / goal.milestones.length) * 100);
    }

    return goal;
  }

  /**
   * Rate a life area (persisted to HutchMem)
   */
  async rateLifeArea(name: string, score: number, notes?: string): Promise<LifeArea | null> {
    const area = this._lifeAreas.find(a => a.name === name);
    if (!area) return null;

    area.currentScore = Math.min(10, Math.max(1, score));
    area.lastUpdated = new Date();
    if (notes) area.notes = notes;

    // Persist to HutchMem
    await this.lifeAreaPersistence.updateScore({
      name: area.name,
      currentScore: area.currentScore,
      targetScore: area.targetScore,
      notes: area.notes,
    });

    return area;
  }

  /**
   * Get the wheel of life assessment
   */
  getWheelOfLife(): { area: string; current: number; target: number; gap: number }[] {
    return this._lifeAreas.map(a => ({
      area: a.name,
      current: a.currentScore,
      target: a.targetScore,
      gap: a.targetScore - a.currentScore,
    }));
  }

  /**
   * Get areas needing attention (biggest gaps)
   */
  getAreasNeedingAttention(topN: number = 3): LifeArea[] {
    return [...this._lifeAreas]
      .sort((a, b) => (b.targetScore - b.currentScore) - (a.targetScore - a.currentScore))
      .slice(0, topN);
  }

  /**
   * Get prompt for goal setting
   */
  getGoalSettingPrompt(area?: string): string {
    const focusArea = area || 'an area you want to improve';

    return `Let's set a meaningful goal for ${focusArea}.

Think through:
1. **What do you want to achieve?** Be specific.
2. **Why does this matter to you?** Connect it to your values.
3. **What would success look like?** Describe the end state.
4. **What milestones mark progress?** Break it into steps.
5. **What might get in the way?** Anticipate obstacles.
6. **Who can support you?** Consider accountability.

Share your thoughts and I'll help you structure this into an actionable goal.`;
  }

  /**
   * Get prompt for weekly review
   */
  getWeeklyReviewPrompt(): string {
    const activeGoals = this._goals.filter(g => g.status === 'active');
    const needsAttention = this.getAreasNeedingAttention(2);

    return `Time for your weekly review.

**Active Goals:**
${activeGoals.length > 0 ? activeGoals.map(g => `- ${g.title} (${g.progress}%)`).join('\n') : '- No active goals'}

**Life Areas Needing Attention:**
${needsAttention.map(a => `- ${a.name}: ${a.currentScore}/10 → target ${a.targetScore}/10`).join('\n')}

Let's reflect on this week:

1. **What went well?** What are you proud of?
2. **What was challenging?** What got in your way?
3. **What did you learn?** Any insights or realizations?
4. **What are you grateful for?** Big or small.
5. **What are your priorities for next week?**

Take your time - this reflection is valuable.`;
  }
}

// ============================================================
// JournalHelper - Capture thoughts and reflections
// ============================================================

export class JournalHelper {
  private entries: JournalEntry[] = [];
  private persistence: JournalPersistence;

  constructor() {
    this.persistence = createJournalPersistence();
  }

  /**
   * Create a journal entry (persisted to HutchMem)
   */
  async createEntry(params: {
    type?: JournalEntry['type'];
    content: string;
    mood?: string;
    highlights?: string[];
    challenges?: string[];
    learnings?: string[];
    tags?: string[];
  }): Promise<JournalEntry> {
    const entry: JournalEntry = {
      id: `jrnl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      date: new Date(),
      type: params.type || 'freeform',
      content: params.content,
      mood: params.mood,
      highlights: params.highlights,
      challenges: params.challenges,
      learnings: params.learnings,
      tags: params.tags || [],
    };

    // Add to in-memory cache
    this.entries.push(entry);

    // Persist to HutchMem
    await this.persistence.create({
      id: entry.id,
      type: entry.type,
      content: entry.content,
      mood: entry.mood,
      highlights: entry.highlights,
      challenges: entry.challenges,
      learnings: entry.learnings,
      tags: entry.tags,
      createdAt: entry.date,
    });

    return entry;
  }

  /**
   * Get entries for a date range
   */
  getEntries(startDate: Date, endDate: Date): JournalEntry[] {
    return this.entries.filter(e =>
      e.date >= startDate && e.date <= endDate
    ).sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  /**
   * Search entries
   */
  search(query: string): JournalEntry[] {
    const queryLower = query.toLowerCase();
    return this.entries.filter(e =>
      e.content.toLowerCase().includes(queryLower) ||
      e.tags.some(t => t.toLowerCase().includes(queryLower))
    );
  }

  /**
   * Get prompt for daily journaling
   */
  getDailyJournalPrompt(): string {
    return `Daily Journal Prompt

Take a few minutes to reflect:

1. **Highlight of the day** - What was the best part?
2. **Challenge faced** - What was difficult?
3. **Something learned** - Any new insight?
4. **Gratitude** - What are you thankful for?
5. **Tomorrow's focus** - What's most important?

Write freely - this is just for you.`;
  }

  /**
   * Get prompt for gratitude journaling
   */
  getGratitudePrompt(): string {
    return `Gratitude Practice

List 3 things you're grateful for today:

1. Something small that made you smile
2. A person who positively impacted you
3. An opportunity or ability you have

For each one, take a moment to really feel the gratitude.`;
  }

  /**
   * Get prompt for reflection
   */
  getReflectionPrompt(topic?: string): string {
    if (topic) {
      return `Reflection: ${topic}

Take time to think deeply about this:

- What happened exactly?
- How did you feel about it?
- What did you learn?
- What would you do differently?
- How does this connect to your bigger goals?
- What action, if any, should you take?`;
    }

    return `Open Reflection

What's on your mind?

This is a space to think through anything:
- Something you're processing
- A decision you're considering
- An emotion you're experiencing
- An idea you're exploring

Write without judgment. Let your thoughts flow.`;
  }
}

// ============================================================
// LocalCompanion - Ties it all together
// ============================================================

export class LocalCompanion {
  public reminders: ReminderHelper;
  public habits: HabitTracker;
  public growth: GrowthTracker;
  public journal: JournalHelper;

  constructor() {
    this.reminders = new ReminderHelper();
    this.habits = new HabitTracker();
    this.growth = new GrowthTracker();
    this.journal = new JournalHelper();
  }

  /**
   * Get morning briefing
   */
  getMorningBriefing(): string {
    const overdue = this.reminders.getOverdue();
    const upcoming = this.reminders.getUpcoming(12);
    const habitsToday = this.habits.getDueToday();
    const activeGoals = this.growth.goals?.filter(g => g.status === 'active') || [];

    let briefing = `Good morning! Here's your briefing:\n\n`;

    if (overdue.length > 0) {
      briefing += `**Overdue Reminders:**\n${overdue.map(r => `- ${r.content}`).join('\n')}\n\n`;
    }

    if (upcoming.length > 0) {
      briefing += `**Coming Up Today:**\n${upcoming.map(r => `- ${r.content}`).join('\n')}\n\n`;
    }

    if (habitsToday.length > 0) {
      briefing += `**Habits to Complete:**\n${habitsToday.map(h => `- ${h.name} (${h.currentStreak} day streak)`).join('\n')}\n\n`;
    }

    if (activeGoals.length > 0) {
      briefing += `**Active Goals:**\n${activeGoals.map(g => `- ${g.title}: ${g.progress}% complete`).join('\n')}\n\n`;
    }

    briefing += `What would you like to focus on today?`;

    return briefing;
  }

  /**
   * Get evening wrap-up
   */
  getEveningWrapUp(): string {
    const habitsCompleted = this.habits.getDueToday().length === 0;

    return `Evening wrap-up time.

**Habits:** ${habitsCompleted ? 'All complete!' : 'Some remaining - want to log any?'}

Let's capture the day:
1. What did you accomplish?
2. Any challenges to note?
3. What are you grateful for?
4. What's on your mind for tomorrow?

This helps me remember and helps you reflect.`;
  }

  /**
   * Process natural language requests
   */
  getIntentPrompt(userMessage: string): string {
    return `User message: "${userMessage}"

I'm a local life companion. Determine what the user needs:

**Possible intents:**
- reminder: They want to remember something
- habit: They want to track or log a habit
- goal: They want to set or update a goal
- journal: They want to write or reflect
- review: They want to see progress or status
- help: They need guidance on something

**Respond with:**
1. The detected intent
2. Key information extracted
3. Clarifying questions if needed
4. Suggested action`;
  }
}

// ============================================================
// Factory Functions
// ============================================================

/**
 * Create a new local companion instance
 */
export function createLocalCompanion(): LocalCompanion {
  return new LocalCompanion();
}

/**
 * Create individual helpers
 */
export function createReminderHelper(): ReminderHelper {
  return new ReminderHelper();
}

export function createHabitTracker(): HabitTracker {
  return new HabitTracker();
}

export function createGrowthTracker(): GrowthTracker {
  return new GrowthTracker();
}

export function createJournalHelper(): JournalHelper {
  return new JournalHelper();
}
