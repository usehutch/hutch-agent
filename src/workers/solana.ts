/**
 * Solana Worker
 *
 * Handles Solana blockchain operations:
 * - Tool installation (solana-cli, anchor)
 * - Wallet management
 * - Program deployment
 * - Devnet interactions
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SOLANA_DIR = join(homedir(), '.config', 'solana');
const ANCHOR_DIR = join(homedir(), '.anchor');

export interface SolanaConfig {
  network: 'devnet' | 'testnet' | 'mainnet-beta';
  keypairPath: string;
  rpcUrl: string;
}

export class SolanaWorker {
  private config: SolanaConfig;

  constructor(network: 'devnet' | 'testnet' | 'mainnet-beta' = 'devnet') {
    this.config = {
      network,
      keypairPath: join(SOLANA_DIR, 'id.json'),
      rpcUrl: this.getRpcUrl(network),
    };
  }

  private getRpcUrl(network: string): string {
    switch (network) {
      case 'devnet':
        return 'https://api.devnet.solana.com';
      case 'testnet':
        return 'https://api.testnet.solana.com';
      case 'mainnet-beta':
        return 'https://api.mainnet-beta.solana.com';
      default:
        return 'https://api.devnet.solana.com';
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Installation
  // ─────────────────────────────────────────────────────────────

  /**
   * Check if Solana CLI is installed
   */
  isSolanaInstalled(): boolean {
    try {
      execSync('solana --version', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Anchor is installed
   */
  isAnchorInstalled(): boolean {
    try {
      execSync('anchor --version', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get installation commands (agent will run these)
   */
  getInstallCommands(): {
    solana: string;
    anchor: string;
    rust: string;
  } {
    return {
      rust: 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y',
      solana: 'sh -c "$(curl -sSfL https://release.solana.com/stable/install)"',
      anchor: 'cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install latest && avm use latest',
    };
  }

  /**
   * Get setup commands for a new project
   */
  getSetupCommands(projectName: string): string[] {
    return [
      // Configure Solana for devnet
      `solana config set --url ${this.config.rpcUrl}`,

      // Generate keypair if not exists
      `[ -f ${this.config.keypairPath} ] || solana-keygen new --no-bip39-passphrase -o ${this.config.keypairPath}`,

      // Airdrop some SOL for testing
      'solana airdrop 2',

      // Initialize Anchor project
      `anchor init ${projectName}`,
    ];
  }

  // ─────────────────────────────────────────────────────────────
  // Wallet Operations
  // ─────────────────────────────────────────────────────────────

  /**
   * Check if wallet exists
   */
  hasWallet(): boolean {
    return existsSync(this.config.keypairPath);
  }

  /**
   * Get wallet address
   */
  getWalletAddress(): string | null {
    if (!this.isSolanaInstalled() || !this.hasWallet()) {
      return null;
    }

    try {
      const result = execSync('solana address', { stdio: 'pipe' });
      return result.toString().trim();
    } catch {
      return null;
    }
  }

  /**
   * Get wallet balance
   */
  getBalance(): number | null {
    if (!this.isSolanaInstalled()) return null;

    try {
      const result = execSync('solana balance', { stdio: 'pipe' });
      const match = result.toString().match(/(\d+\.?\d*)/);
      return match ? parseFloat(match[1]) : null;
    } catch {
      return null;
    }
  }

  /**
   * Request airdrop (devnet only)
   */
  async requestAirdrop(amount: number = 2): Promise<{
    success: boolean;
    signature?: string;
    error?: string;
  }> {
    if (this.config.network !== 'devnet') {
      return { success: false, error: 'Airdrop only available on devnet' };
    }

    try {
      const result = execSync(`solana airdrop ${amount}`, { stdio: 'pipe' });
      const output = result.toString();
      const match = output.match(/Signature: (\w+)/);
      return {
        success: true,
        signature: match ? match[1] : undefined,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Anchor Project Operations
  // ─────────────────────────────────────────────────────────────

  /**
   * Build Anchor project
   */
  buildProject(projectPath: string): {
    success: boolean;
    output?: string;
    error?: string;
  } {
    try {
      const result = execSync('anchor build', {
        cwd: projectPath,
        stdio: 'pipe',
      });
      return { success: true, output: result.toString() };
    } catch (err: any) {
      return { success: false, error: err.stderr?.toString() || err.message };
    }
  }

  /**
   * Run Anchor tests
   */
  runTests(projectPath: string): {
    success: boolean;
    output?: string;
    error?: string;
  } {
    try {
      const result = execSync('anchor test', {
        cwd: projectPath,
        stdio: 'pipe',
      });
      return { success: true, output: result.toString() };
    } catch (err: any) {
      return { success: false, error: err.stderr?.toString() || err.message };
    }
  }

  /**
   * Deploy to devnet
   */
  deploy(projectPath: string): {
    success: boolean;
    programId?: string;
    error?: string;
  } {
    try {
      const result = execSync('anchor deploy', {
        cwd: projectPath,
        stdio: 'pipe',
      });
      const output = result.toString();

      // Extract program ID from output
      const match = output.match(/Program Id: (\w+)/);
      return {
        success: true,
        programId: match ? match[1] : undefined,
      };
    } catch (err: any) {
      return { success: false, error: err.stderr?.toString() || err.message };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Project Templates
  // ─────────────────────────────────────────────────────────────

  /**
   * Get template for NEXUS Agent Registry program
   */
  getAgentRegistryTemplate(): string {
    return `use anchor_lang::prelude::*;

declare_id!("NEXUSxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

#[program]
pub mod nexus_registry {
    use super::*;

    /// Register a new agent
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        name: String,
        capabilities: Vec<String>,
    ) -> Result<()> {
        let agent = &mut ctx.accounts.agent;
        agent.owner = ctx.accounts.owner.key();
        agent.name = name;
        agent.capabilities = capabilities;
        agent.reputation = 0;
        agent.tasks_completed = 0;
        agent.registered_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Stake tokens for reputation
    pub fn stake_reputation(
        ctx: Context<StakeReputation>,
        amount: u64,
    ) -> Result<()> {
        let agent = &mut ctx.accounts.agent;
        agent.reputation = agent.reputation.checked_add(amount).unwrap();
        // Transfer tokens to vault...
        Ok(())
    }

    /// Complete a task and earn reputation
    pub fn complete_task(
        ctx: Context<CompleteTask>,
        task_id: String,
    ) -> Result<()> {
        let agent = &mut ctx.accounts.agent;
        agent.tasks_completed = agent.tasks_completed.checked_add(1).unwrap();
        agent.reputation = agent.reputation.checked_add(10).unwrap();
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + Agent::INIT_SPACE,
        seeds = [b"agent", owner.key().as_ref()],
        bump
    )]
    pub agent: Account<'info, Agent>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StakeReputation<'info> {
    #[account(mut, seeds = [b"agent", owner.key().as_ref()], bump)]
    pub agent: Account<'info, Agent>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct CompleteTask<'info> {
    #[account(mut, seeds = [b"agent", owner.key().as_ref()], bump)]
    pub agent: Account<'info, Agent>,
    pub owner: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Agent {
    pub owner: Pubkey,
    #[max_len(32)]
    pub name: String,
    #[max_len(10, 32)]
    pub capabilities: Vec<String>,
    pub reputation: u64,
    pub tasks_completed: u64,
    pub registered_at: i64,
}
`;
  }

  /**
   * Get status summary
   */
  getStatus(): {
    solanaInstalled: boolean;
    anchorInstalled: boolean;
    hasWallet: boolean;
    walletAddress: string | null;
    balance: number | null;
    network: string;
  } {
    return {
      solanaInstalled: this.isSolanaInstalled(),
      anchorInstalled: this.isAnchorInstalled(),
      hasWallet: this.hasWallet(),
      walletAddress: this.getWalletAddress(),
      balance: this.getBalance(),
      network: this.config.network,
    };
  }
}
