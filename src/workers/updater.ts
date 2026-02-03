/**
 * Self-Update Worker
 *
 * Hutch can check and update its own repositories:
 * - hutch-agent (this framework)
 * - hutch-mem (memory system)
 * - nexus-acp (the project being built)
 * - hutch-colosseum (frontend)
 */

import { spawn } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';

export interface RepoStatus {
  name: string;
  path: string;
  hasUpdates: boolean;
  currentCommit: string;
  remoteCommit: string;
  behind: number;
  ahead: number;
}

export interface UpdateResult {
  repo: string;
  success: boolean;
  message: string;
  previousCommit?: string;
  newCommit?: string;
}

export class UpdaterWorker {
  private repos = [
    {
      name: 'hutch-agent',
      path: join(homedir(), 'nexus'),  // Local path might be 'nexus' for now
      remote: 'https://github.com/usehutch/hutch-agent.git',
    },
    {
      name: 'hutch-mem',
      path: join(homedir(), 'hutch-mem'),
      remote: 'https://github.com/usehutch/hutch-mem.git',
    },
    {
      name: 'nexus-acp',
      path: join(homedir(), 'nexus-acp'),
      remote: 'https://github.com/usehutch/nexus-acp.git',
    },
    {
      name: 'hutch-colosseum',
      path: join(homedir(), 'hutch-colosseum'),
      remote: 'https://github.com/usehutch/hutch-colosseum.git',
    },
  ];

  /**
   * Check all repos for updates
   */
  async checkAllRepos(): Promise<RepoStatus[]> {
    const statuses: RepoStatus[] = [];

    for (const repo of this.repos) {
      if (existsSync(repo.path)) {
        const status = await this.checkRepo(repo.name, repo.path);
        statuses.push(status);
      }
    }

    return statuses;
  }

  /**
   * Check a single repo for updates
   */
  async checkRepo(name: string, path: string): Promise<RepoStatus> {
    try {
      // Fetch latest from remote
      await this.runGit(path, ['fetch', 'origin']);

      // Get current commit
      const currentCommit = await this.runGit(path, ['rev-parse', 'HEAD']);

      // Get remote commit
      const remoteCommit = await this.runGit(path, ['rev-parse', 'origin/main']);

      // Count commits behind/ahead
      const behindAhead = await this.runGit(path, [
        'rev-list',
        '--left-right',
        '--count',
        'HEAD...origin/main',
      ]);
      const [ahead, behind] = behindAhead.trim().split('\t').map(Number);

      return {
        name,
        path,
        hasUpdates: behind > 0,
        currentCommit: currentCommit.trim().slice(0, 7),
        remoteCommit: remoteCommit.trim().slice(0, 7),
        behind,
        ahead,
      };
    } catch (error: any) {
      return {
        name,
        path,
        hasUpdates: false,
        currentCommit: 'unknown',
        remoteCommit: 'unknown',
        behind: 0,
        ahead: 0,
      };
    }
  }

  /**
   * Update a specific repo
   */
  async updateRepo(name: string): Promise<UpdateResult> {
    const repo = this.repos.find(r => r.name === name);
    if (!repo) {
      return { repo: name, success: false, message: 'Repository not found' };
    }

    if (!existsSync(repo.path)) {
      return { repo: name, success: false, message: 'Repository path does not exist' };
    }

    try {
      // Get current commit before update
      const previousCommit = await this.runGit(repo.path, ['rev-parse', 'HEAD']);

      // Stash any local changes
      await this.runGit(repo.path, ['stash']);

      // Pull latest
      await this.runGit(repo.path, ['pull', 'origin', 'main']);

      // Get new commit
      const newCommit = await this.runGit(repo.path, ['rev-parse', 'HEAD']);

      // If this is hutch-agent, rebuild
      if (name === 'hutch-agent') {
        await this.rebuild(repo.path);
      }

      // If this is hutch-mem, reinstall
      if (name === 'hutch-mem') {
        await this.reinstall(repo.path);
      }

      return {
        repo: name,
        success: true,
        message: 'Updated successfully',
        previousCommit: previousCommit.trim().slice(0, 7),
        newCommit: newCommit.trim().slice(0, 7),
      };
    } catch (error: any) {
      return {
        repo: name,
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Update all repos with available updates
   */
  async updateAll(): Promise<UpdateResult[]> {
    const statuses = await this.checkAllRepos();
    const results: UpdateResult[] = [];

    for (const status of statuses) {
      if (status.hasUpdates) {
        const result = await this.updateRepo(status.name);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Rebuild hutch-agent after update
   */
  private async rebuild(path: string): Promise<void> {
    await this.runCommand(path, 'bun', ['install']);
    await this.runCommand(path, 'bun', ['run', 'build']);
  }

  /**
   * Reinstall hutch-mem after update
   */
  private async reinstall(path: string): Promise<void> {
    await this.runCommand(path, 'bun', ['install']);
  }

  /**
   * Run a git command
   */
  private runGit(cwd: string, args: string[]): Promise<string> {
    return this.runCommand(cwd, 'git', args);
  }

  /**
   * Run a command and return output
   */
  private runCommand(cwd: string, command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { cwd });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', data => { stdout += data.toString(); });
      proc.stderr.on('data', data => { stderr += data.toString(); });

      proc.on('close', code => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Command failed with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Get prompt for checking updates (for agent to use)
   */
  getCheckUpdatesPrompt(): string {
    return `Check for updates to Hutch's repositories:

1. Run: git fetch origin (for each repo)
2. Check if there are new commits on origin/main
3. Report which repos have updates available
4. If updates found, consider updating (but be careful with hutch-agent - that's the running code!)

Repos to check:
- ~/nexus (hutch-agent)
- ~/hutch-mem
- ~/nexus-acp
- ~/hutch-colosseum

Report the status and recommend whether to update.`;
  }
}
