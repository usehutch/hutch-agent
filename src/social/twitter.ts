/**
 * Twitter Social Worker
 *
 * Posts updates to Twitter for hackathon visibility.
 * Requires TWITTER_BEARER_TOKEN environment variable.
 */

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
   * Post a tweet
   */
  async post(tweet: Tweet): Promise<TweetResult> {
    if (!this.enabled || !this.bearerToken) {
      return {
        success: false,
        error: 'Twitter not configured',
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

  /**
   * Post a progress update
   */
  async postProgress(milestone: string, details?: string): Promise<TweetResult> {
    const text = details
      ? `🤖 NEXUS Agent Progress\n\n${milestone}\n\n${details}\n\n#ColosseumHackathon #AI #Solana`
      : `🤖 NEXUS Agent Progress\n\n${milestone}\n\n#ColosseumHackathon #AI #Solana`;

    // Truncate if too long (280 char limit)
    const truncated = text.length > 280 ? text.slice(0, 277) + '...' : text;

    return this.post({ text: truncated });
  }

  /**
   * Post a daily summary
   */
  async postDailySummary(stats: {
    tasksCompleted: number;
    progress: number;
    hoursRemaining: number;
  }): Promise<TweetResult> {
    const text = `📊 NEXUS Daily Update

✅ Tasks completed today: ${stats.tasksCompleted}
📈 Overall progress: ${stats.progress}%
⏰ ${stats.hoursRemaining}h until hackathon deadline

Building autonomously 24/7 🔄

#ColosseumHackathon #AI #Solana`;

    return this.post({ text });
  }
}
