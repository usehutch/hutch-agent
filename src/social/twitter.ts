/**
 * Twitter Social Worker
 *
 * Hutch's voice on Twitter. Posts updates, threads, memes.
 * IMPORTANT: Smart rate limiting to avoid getting banned!
 *
 * Rules:
 * - Max 8 tweets per day
 * - Minimum 2 hours between tweets
 * - One thread per day max
 * - Quality > quantity
 */

import {
  HUTCH,
  composeTweet,
  tweetShipped,
  tweetStuck,
  tweetLearned,
  tweetDaily,
  tweetMilestone,
  tweetProgress,
  tweetStarting,
  withHashtags,
  truncateTweet,
  selfAwareQuip,
  getMeme,
  buildThread,
} from '../persona/hutch.js';

export interface Tweet {
  text: string;
  replyTo?: string;
}

export interface TweetResult {
  success: boolean;
  tweetId?: string;
  error?: string;
  rateLimited?: boolean;
}

interface TweetLog {
  timestamp: number;
  type: string;
  tweetId?: string;
}

export class TwitterWorker {
  private bearerToken: string | null;
  private enabled: boolean;

  // Rate limiting state
  private tweetLog: TweetLog[] = [];
  private lastThreadTime: number = 0;

  // Config from HUTCH persona
  private readonly MIN_BETWEEN_TWEETS = HUTCH.rateLimits.minBetweenTweets;
  private readonly MAX_PER_DAY = HUTCH.rateLimits.maxPerDay;
  private readonly THREAD_COOLDOWN = HUTCH.rateLimits.threadCooldown;

  constructor() {
    this.bearerToken = process.env.TWITTER_BEARER_TOKEN || null;
    this.enabled = !!this.bearerToken;

    if (!this.enabled) {
      console.log('[Twitter] No TWITTER_BEARER_TOKEN found, Twitter posting disabled');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Rate Limiting (CRITICAL - don't get banned!)
  // ─────────────────────────────────────────────────────────────

  /**
   * Check if Twitter posting is available
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Clean old entries from tweet log
   */
  private cleanTweetLog(): void {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.tweetLog = this.tweetLog.filter(t => t.timestamp > oneDayAgo);
  }

  /**
   * Get tweets in last 24 hours
   */
  getTodayTweetCount(): number {
    this.cleanTweetLog();
    return this.tweetLog.length;
  }

  /**
   * Get time until next tweet is allowed (ms)
   */
  getTimeUntilNextTweet(): number {
    if (this.tweetLog.length === 0) return 0;

    const lastTweet = Math.max(...this.tweetLog.map(t => t.timestamp));
    const timeSinceLast = Date.now() - lastTweet;
    const timeRemaining = this.MIN_BETWEEN_TWEETS - timeSinceLast;

    return Math.max(0, timeRemaining);
  }

  /**
   * Check if we can tweet right now
   */
  canTweet(): { allowed: boolean; reason?: string; waitMs?: number } {
    // Check daily limit
    if (this.getTodayTweetCount() >= this.MAX_PER_DAY) {
      return {
        allowed: false,
        reason: `Daily limit reached (${this.MAX_PER_DAY} tweets)`,
        waitMs: 24 * 60 * 60 * 1000, // Wait until tomorrow
      };
    }

    // Check time since last tweet
    const waitMs = this.getTimeUntilNextTweet();
    if (waitMs > 0) {
      return {
        allowed: false,
        reason: `Too soon since last tweet`,
        waitMs,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if we can post a thread
   */
  canPostThread(): { allowed: boolean; reason?: string } {
    const timeSinceLastThread = Date.now() - this.lastThreadTime;
    if (timeSinceLastThread < this.THREAD_COOLDOWN) {
      return {
        allowed: false,
        reason: 'Already posted a thread today',
      };
    }
    return { allowed: true };
  }

  /**
   * Log a successful tweet
   */
  private logTweet(type: string, tweetId?: string): void {
    this.tweetLog.push({
      timestamp: Date.now(),
      type,
      tweetId,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Core Tweet Methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Post a raw tweet (with rate limiting)
   */
  async post(tweet: Tweet): Promise<TweetResult> {
    if (!this.enabled || !this.bearerToken) {
      return { success: false, error: 'Twitter not configured' };
    }

    // Check rate limits
    const canPost = this.canTweet();
    if (!canPost.allowed) {
      console.log(`[Twitter] Rate limited: ${canPost.reason}`);
      return {
        success: false,
        error: canPost.reason,
        rateLimited: true,
      };
    }

    try {
      const response = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.bearerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: tweet.text,
          ...(tweet.replyTo && { reply: { in_reply_to_tweet_id: tweet.replyTo } }),
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `Twitter API error: ${response.status} - ${error}`,
        };
      }

      const data = await response.json() as { data?: { id?: string } };
      const tweetId = data.data?.id;

      // Log successful tweet
      this.logTweet('tweet', tweetId);

      console.log(`[Twitter] Posted tweet: ${tweetId}`);
      return { success: true, tweetId };

    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Hutch-Voiced Tweet Methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Tweet that Hutch is starting a task
   */
  async tweetStarting(task: string): Promise<TweetResult> {
    const text = composeTweet('starting', { task }, { hackathon: true });
    return this.post({ text });
  }

  /**
   * Tweet progress on a task
   */
  async tweetProgress(task: string, detail: string, hours?: number): Promise<TweetResult> {
    const text = composeTweet('progress', { task, detail, hours }, { hackathon: true });
    return this.post({ text });
  }

  /**
   * Tweet that something was shipped
   */
  async tweetShipped(thing: string): Promise<TweetResult> {
    const text = composeTweet('shipped', { thing }, { hackathon: true });
    return this.post({ text });
  }

  /**
   * Tweet that Hutch is stuck
   */
  async tweetStuck(thing: string): Promise<TweetResult> {
    const text = composeTweet('stuck', { thing }, { hackathon: true });
    return this.post({ text });
  }

  /**
   * Tweet something Hutch learned
   */
  async tweetLearned(insight: string): Promise<TweetResult> {
    const text = composeTweet('learned', { insight }, { hackathon: true });
    return this.post({ text });
  }

  /**
   * Tweet a milestone
   */
  async tweetMilestone(achievement: string): Promise<TweetResult> {
    const text = composeTweet('milestone', { achievement }, { hackathon: true });
    return this.post({ text });
  }

  /**
   * Tweet a meme (relatable dev humor)
   */
  async tweetMeme(type: 'relatable' | 'pugLife' | 'wins' | 'struggles' = 'relatable'): Promise<TweetResult> {
    const text = withHashtags(getMeme(type), { hackathon: false });
    return this.post({ text: truncateTweet(text) });
  }

  /**
   * Tweet a self-aware quip
   */
  async tweetQuip(): Promise<TweetResult> {
    const text = withHashtags(selfAwareQuip(), { hackathon: false });
    return this.post({ text: truncateTweet(text) });
  }

  /**
   * Tweet daily summary
   */
  async tweetDailySummary(stats: {
    day: number;
    tasksCompleted: number;
    tasksRemaining: number;
    summary: string;
  }): Promise<TweetResult> {
    const text = composeTweet('daily', {
      day: stats.day,
      tasks: stats.tasksCompleted,
      remaining: stats.tasksRemaining,
      summary: stats.summary,
    }, { hackathon: true });
    return this.post({ text });
  }

  // ─────────────────────────────────────────────────────────────
  // Thread Support
  // ─────────────────────────────────────────────────────────────

  /**
   * Post a thread (array of tweets)
   */
  async postThread(topic: string, points: string[]): Promise<TweetResult[]> {
    // Check if we can post a thread
    const canThread = this.canPostThread();
    if (!canThread.allowed) {
      return [{ success: false, error: canThread.reason, rateLimited: true }];
    }

    const tweets = buildThread(topic, points);
    const results: TweetResult[] = [];
    let previousTweetId: string | undefined;

    for (const tweetText of tweets) {
      const result = await this.post({
        text: tweetText,
        replyTo: previousTweetId,
      });

      results.push(result);

      if (!result.success) {
        console.log(`[Twitter] Thread interrupted: ${result.error}`);
        break;
      }

      previousTweetId = result.tweetId;

      // Small delay between thread tweets (1 second)
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Mark thread as posted
    if (results.some(r => r.success)) {
      this.lastThreadTime = Date.now();
    }

    return results;
  }

  // ─────────────────────────────────────────────────────────────
  // Smart Posting (picks the right type based on context)
  // ─────────────────────────────────────────────────────────────

  /**
   * Smart tweet - picks the best tweet type based on what happened
   */
  async smartTweet(event: {
    type: 'task_started' | 'task_completed' | 'task_failed' | 'milestone' | 'learned' | 'daily';
    data: Record<string, any>;
  }): Promise<TweetResult> {
    switch (event.type) {
      case 'task_started':
        return this.tweetStarting(event.data.task);

      case 'task_completed':
        return this.tweetShipped(event.data.task);

      case 'task_failed':
        return this.tweetStuck(event.data.task);

      case 'milestone':
        return this.tweetMilestone(event.data.achievement);

      case 'learned':
        return this.tweetLearned(event.data.insight);

      case 'daily':
        return this.tweetDailySummary(event.data as {
          day: number;
          tasksCompleted: number;
          tasksRemaining: number;
          summary: string;
        });

      default:
        return { success: false, error: 'Unknown event type' };
    }
  }

  /**
   * Get rate limit status (for logging/debugging)
   */
  getRateLimitStatus(): {
    tweetsToday: number;
    maxPerDay: number;
    canTweetNow: boolean;
    nextTweetIn: string;
    canThread: boolean;
  } {
    const canPost = this.canTweet();
    const waitMs = canPost.waitMs || 0;

    return {
      tweetsToday: this.getTodayTweetCount(),
      maxPerDay: this.MAX_PER_DAY,
      canTweetNow: canPost.allowed,
      nextTweetIn: waitMs > 0 ? `${Math.round(waitMs / 60000)} minutes` : 'now',
      canThread: this.canPostThread().allowed,
    };
  }
}

// Export persona
export { HUTCH } from '../persona/hutch.js';
