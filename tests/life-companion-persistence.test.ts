/**
 * Life Companion Persistence Layer - Integration Tests
 *
 * Tests the persistence layer's integration with the HutchMem API.
 * Requires HutchMem worker to be running on localhost:37777
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import {
  ReminderPersistence,
  HabitPersistence,
  GoalPersistence,
  JournalPersistence,
  LifeAreaPersistence,
  WeeklyReviewPersistence,
  type ReminderRecord,
  type HabitRecord,
  type GoalRecord,
  type JournalRecord,
} from '../src/capabilities/life-companion-persistence.js';

// Generate unique IDs for tests
const testId = (prefix: string) => `test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  // Verify HutchMem worker is running
  try {
    const response = await fetch('http://localhost:37777/health');
    if (!response.ok) {
      throw new Error('HutchMem worker not healthy');
    }
  } catch (error) {
    console.error('HutchMem worker not running. Start with: bun plugin/scripts/worker-service.cjs start');
    throw error;
  }
});

describe('ReminderPersistence', () => {
  const persistence = new ReminderPersistence();

  it('creates a reminder successfully', async () => {
    const reminder: ReminderRecord = {
      id: testId('reminder'),
      content: 'Test reminder from persistence layer',
      priority: 'high',
      status: 'pending',
      tags: ['test', 'integration'],
      createdAt: new Date(),
    };

    const result = await persistence.create(reminder);

    expect(result.success).toBe(true);
    expect(result.structuredId).toBe(reminder.id);
  });

  it('creates a reminder with due date', async () => {
    const reminder: ReminderRecord = {
      id: testId('reminder'),
      content: 'Reminder with due date',
      priority: 'medium',
      status: 'pending',
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
      tags: [],
      createdAt: new Date(),
    };

    const result = await persistence.create(reminder);

    expect(result.success).toBe(true);
  });

  it('creates a recurring reminder', async () => {
    const reminder: ReminderRecord = {
      id: testId('reminder'),
      content: 'Daily reminder',
      priority: 'low',
      status: 'pending',
      recurring: {
        frequency: 'daily',
        interval: 1,
      },
      tags: ['recurring'],
      createdAt: new Date(),
    };

    const result = await persistence.create(reminder);

    expect(result.success).toBe(true);
  });

  it('completes a reminder', async () => {
    // First create one
    const reminder: ReminderRecord = {
      id: testId('reminder'),
      content: 'Reminder to complete',
      priority: 'medium',
      status: 'pending',
      tags: [],
      createdAt: new Date(),
    };

    await persistence.create(reminder);

    // Then complete it
    const result = await persistence.complete(reminder.id, reminder.content);

    expect(result.success).toBe(true);
  });

  it('gets overdue reminders', async () => {
    const reminders = await persistence.getOverdue();

    expect(Array.isArray(reminders)).toBe(true);
  });

  it('gets upcoming reminders', async () => {
    const reminders = await persistence.getUpcoming(48); // Next 48 hours

    expect(Array.isArray(reminders)).toBe(true);
  });
});

describe('HabitPersistence', () => {
  const persistence = new HabitPersistence();

  it('creates a habit successfully', async () => {
    const habit: HabitRecord = {
      id: testId('habit'),
      name: 'Test meditation habit',
      description: 'Daily meditation for mindfulness',
      frequency: 'daily',
      targetPerPeriod: 1,
      currentStreak: 0,
      longestStreak: 0,
      category: 'mindfulness',
      active: true,
      createdAt: new Date(),
    };

    const result = await persistence.create(habit);

    expect(result.success).toBe(true);
    expect(result.structuredId).toBe(habit.id);
  });

  it('logs a habit completion', async () => {
    // First create a habit
    const habit: HabitRecord = {
      id: testId('habit'),
      name: 'Exercise habit',
      frequency: 'daily',
      targetPerPeriod: 1,
      currentStreak: 0,
      longestStreak: 0,
      category: 'health',
      active: true,
      createdAt: new Date(),
    };

    await persistence.create(habit);

    // Log completion
    const today = new Date().toISOString().split('T')[0];
    const result = await persistence.logCompletion({
      habitId: habit.id,
      habitName: habit.name,
      date: today,
      count: 1,
      notes: 'Completed morning exercise',
      mood: 'good',
    });

    expect(result.success).toBe(true);
  });

  it('gets habits due today', async () => {
    const habits = await persistence.getDueToday();

    expect(Array.isArray(habits)).toBe(true);
  });
});

describe('GoalPersistence', () => {
  const persistence = new GoalPersistence();

  it('creates a goal successfully', async () => {
    const goal: GoalRecord = {
      id: testId('goal'),
      area: 'health',
      title: 'Run a 5K',
      description: 'Train to run 5 kilometers without stopping',
      targetDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      progress: 0,
      status: 'active',
      milestones: ['Run 1K', 'Run 2K', 'Run 3K', 'Run 5K'],
      createdAt: new Date(),
    };

    const result = await persistence.create(goal);

    expect(result.success).toBe(true);
    expect(result.structuredId).toBe(goal.id);
  });

  it('updates goal progress', async () => {
    // First create a goal
    const goal: GoalRecord = {
      id: testId('goal'),
      area: 'learning',
      title: 'Learn TypeScript',
      description: 'Master TypeScript fundamentals',
      progress: 0,
      status: 'active',
      milestones: [],
      createdAt: new Date(),
    };

    await persistence.create(goal);

    // Update progress
    const result = await persistence.updateProgress(
      goal.id,
      goal.title,
      25,
      'Completed basic types chapter'
    );

    expect(result.success).toBe(true);
  });

  it('gets active goals', async () => {
    const goals = await persistence.getActive();

    expect(Array.isArray(goals)).toBe(true);
  });
});

describe('JournalPersistence', () => {
  const persistence = new JournalPersistence();

  it('creates a journal entry successfully', async () => {
    const journal: JournalRecord = {
      id: testId('journal'),
      type: 'daily',
      content: 'Today was productive. Made progress on the integration tests.',
      mood: 'good',
      highlights: ['Finished testing framework', 'Fixed validation bugs'],
      challenges: ['Complex async handling'],
      learnings: ['Better understanding of Bun test runner'],
      tags: ['work', 'coding'],
      createdAt: new Date(),
    };

    const result = await persistence.create(journal);

    expect(result.success).toBe(true);
    expect(result.structuredId).toBe(journal.id);
  });

  it('creates a gratitude journal', async () => {
    const journal: JournalRecord = {
      id: testId('journal'),
      type: 'gratitude',
      content: 'Grateful for the opportunity to build meaningful software.',
      tags: ['gratitude'],
      createdAt: new Date(),
    };

    const result = await persistence.create(journal);

    expect(result.success).toBe(true);
  });

  it('gets recent journals', async () => {
    const journals = await persistence.getRecent(5);

    expect(Array.isArray(journals)).toBe(true);
  });

  it('searches journals', async () => {
    // First create one with searchable content
    const journal: JournalRecord = {
      id: testId('journal'),
      type: 'freeform',
      content: 'This journal contains the word UNIQUE_SEARCH_TERM_12345 for testing.',
      tags: [],
      createdAt: new Date(),
    };

    await persistence.create(journal);

    // Search for it
    const results = await persistence.search('UNIQUE_SEARCH_TERM_12345');

    expect(Array.isArray(results)).toBe(true);
    // Note: Results may be empty if search is not immediate
  });
});

describe('LifeAreaPersistence', () => {
  const persistence = new LifeAreaPersistence();

  it('updates a life area score', async () => {
    const result = await persistence.updateScore({
      name: 'Test Health Area',
      currentScore: 7,
      targetScore: 9,
      notes: 'Improved exercise consistency this week',
    });

    expect(result.success).toBe(true);
  });

  it('gets all life areas', async () => {
    const areas = await persistence.getAll();

    expect(Array.isArray(areas)).toBe(true);
  });
});

describe('WeeklyReviewPersistence', () => {
  const persistence = new WeeklyReviewPersistence();

  it('creates a weekly review', async () => {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of this week

    const result = await persistence.create({
      weekStart,
      accomplishments: ['Completed integration tests', 'Fixed validation bugs'],
      challenges: ['Complex async handling', 'Time management'],
      lessonsLearned: ['Better testing practices', 'Importance of validation'],
      gratitude: ['Good team collaboration', 'Learning opportunities'],
      nextWeekPriorities: ['Deploy to production', 'Write documentation'],
      overallRating: 8,
      notes: 'A productive week overall',
    });

    expect(result.success).toBe(true);
  });

  it('gets recent weekly reviews', async () => {
    const reviews = await persistence.getRecent(2);

    expect(Array.isArray(reviews)).toBe(true);
  });
});
