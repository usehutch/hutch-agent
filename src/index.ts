/**
 * Hutch Agent
 *
 * Your Local AI Companion for Productivity
 *
 * A 24/7 autonomous AI agent that helps you:
 * - Complete tasks and projects efficiently
 * - Research and gather information
 * - Automate repetitive work
 * - Learn and adapt to your workflows
 * - Maintain context across sessions
 */

// Core Agent Loop
export { runLoop } from './core/loop.js';
export { runCycle } from './core/cycle.js';
export { Heartbeat, HealthMetrics } from './core/heartbeat.js';
export { Planner, Plan } from './core/planner.js';
export { Reflector, Reflection } from './core/reflector.js';

// Loop Prevention & Reliability
export { CircuitBreaker, createCircuitBreaker } from './core/circuit-breaker.js';
export { StateMachine, createStateMachine } from './core/state-machine.js';

// Task Management
export { Scheduler, Goal, Task } from './scheduler/scheduler.js';
export { DAGScheduler, createDAGScheduler } from './scheduler/dag-scheduler.js';

// Prompts & Persona
export { getSystemPrompt, getReasoningPrompt, getTaskPrompt } from './prompts/system.js';
export { HUTCH, HutchCapabilities } from './persona/hutch.js';

// Productivity Capabilities
export { ProductivityHelper, TaskAssistant, ResearchHelper } from './capabilities/productivity.js';

// Life Companion Capabilities
export {
  LocalCompanion,
  ReminderHelper,
  HabitTracker,
  GrowthTracker,
  JournalHelper,
  createLocalCompanion,
} from './capabilities/life-companion.js';

// Life Companion Persistence (dual-write to HutchMem)
export {
  ReminderPersistence,
  HabitPersistence,
  GoalPersistence,
  JournalPersistence,
  LifeAreaPersistence,
  WeeklyReviewPersistence,
} from './capabilities/life-companion-persistence.js';

// Memory Integration
export { HutchMemBridge, getHutchMem } from './memory/bridge.js';

// Tools
export { TERMINATION_TOOL_DEFINITIONS, TerminationHandler } from './tools/termination.js';

// Workers
export { ResearchWorker } from './workers/research.js';
export { UpdaterWorker } from './workers/updater.js';
