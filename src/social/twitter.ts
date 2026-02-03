/**
 * Twitter Social Worker
 *
 * Posts updates to Twitter using Hutch's voice and persona.
 * Requires TWITTER_BEARER_TOKEN environment variable.
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
} from '../persona/hutch.js';

export interface Tweet {
  text: string;
  replyTo?: string;
}

export interface TweetResult {
  success: boolean;
  tweetId?: string;
  error?: string;
}

export class TwitterWorker {
  private bearerToken: string | null;
  private enabled: boolean;
  private lastTweetTime: number = 0;
  private minInterval: number = 30 * 60 * 1000; // 30 minutes between tweets

  constructor() {
    this.bearerToken = process.env.TWITTER_BEARER_TOKEN || null;
    this.enabled = !!this.bearerToken;

    if (!this.enabled) {
      console.log('[Twitter] No TWITTER_BEARER_TOKEN found, Twitter posting disabled');
    }
  }

  /**
   * Check if Twitter posting is available
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if we can tweet (rate limiting)
   */
  canTweet(): boolean {
    return Date.now() - this.lastTweetTime > this.minInterval;
  }

  /**
   * Post a raw tweet
   */
  async post(tweet: Tweet): Promise<TweetResult> {
    if (!this.enabled || !this.bearerToken) {
      return {
        success: false,
        error: 'Twitter not configured',
      };
    }

    if (!this.canTweet()) {
      return {
        success: false,
        error: 'Rate limited - too soon since last tweet',
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
      this.lastTweetTime = Date.now();

      return {
        success: true,
        tweetId: data.data?.id,
      };

    } catch (err: any) {
      return {
        success: false,
        error: err.message,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Hutch-Voiced Tweet Methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Tweet that Hutch is starting a task
   */
  async tweetStarting(task: string): Promise<TweetResult> {
    const text = withHashtags(tweetStarting(task));
    return this.post({ text: truncateTweet(text) });
  }

  /**
   * Tweet progress on a task
   */
  async tweetProgress(task: string, detail: string, hours?: number): Promise<TweetResult> {
    const text = withHashtags(tweetProgress(task, detail, hours));
    return this.post({ text: truncateTweet(text) });
  }

  /**
   * Tweet that something was shipped
   */
  async tweetShipped(thing: string): Promise<TweetResult> {
    const text = withHashtags(tweetShipped(thing));
    return this.post({ text: truncateTweet(text) });
  }

  /**
   * Tweet that Hutch is stuck
   */
  async tweetStuck(thing: string): Promise<TweetResult> {
    const text = withHashtags(tweetStuck(thing));
    return this.post({ text: truncateTweet(text) });
  }

  /**
   * Tweet something Hutch learned
   */
  async tweetLearned(insight: string): Promise<TweetResult> {
    const text = withHashtags(tweetLearned(insight));
    return this.post({ text: truncateTweet(text) });
  }

  /**
   * Tweet a milestone achievement
   */
  async tweetMilestone(achievement: string): Promise<TweetResult> {
    const text = withHashtags(tweetMilestone(achievement));
    return this.post({ text: truncateTweet(text) });
  }

  /**
   * Tweet the daily summary
   */
  async tweetDailySummary(stats: {
    day: number;
    tasksCompleted: number;
    tasksRemaining: number;
    hoursElapsed: number;
    highlights: string[];
  }): Promise<TweetResult> {
    // Build a natural daily summary
    const summary = stats.highlights.length > 0
      ? stats.highlights[0]
      : `${stats.tasksCompleted} tasks shipped`;

    const text = withHashtags(tweetDaily({
      day: stats.day,
      hours: stats.hoursElapsed,
      tasks: stats.tasksCompleted,
      remaining: stats.tasksRemaining,
      summary,
    }));

    return this.post({ text: truncateTweet(text) });
  }

  /**
   * Tweet a self-aware quip (for personality)
   */
  async tweetQuip(): Promise<TweetResult> {
    const text = withHashtags(selfAwareQuip());
    return this.post({ text: truncateTweet(text) });
  }

  /**
   * Compose and tweet using the general composer
   */
  async tweet(
    type: 'starting' | 'progress' | 'shipped' | 'stuck' | 'learned' | 'daily' | 'milestone',
    content: Record<string, any>
  ): Promise<TweetResult> {
    const text = composeTweet(type, content);
    return this.post({ text });
  }
}

// Export persona for direct access
export { HUTCH } from '../persona/hutch.js';
