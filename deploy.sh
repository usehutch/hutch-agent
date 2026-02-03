#!/bin/bash
# Hutch Agent Deployment Script
# Run this on a fresh VM to set up everything

set -e

echo "═══════════════════════════════════════════════════════════"
echo "  Hutch Agent Deployment"
echo "  24/7 Autonomous AI Agent for Colosseum Hackathon"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if running as root or with sudo
if [ "$EUID" -eq 0 ]; then
    SUDO=""
else
    SUDO="sudo"
fi

# 1. Install system dependencies
echo "[1/9] Installing system dependencies..."
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq git curl unzip build-essential pkg-config libssl-dev

# 2. Install Bun
echo "[2/9] Installing Bun..."
if ! command -v bun &> /dev/null; then
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
else
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

# 3. Install Claude Code CLI
echo "[3/9] Installing Claude Code CLI..."
if ! command -v claude &> /dev/null; then
    curl -fsSL https://claude.ai/install.sh | sh
fi

# 4. Install Rust (for Solana/Anchor)
echo "[4/9] Installing Rust..."
if ! command -v rustc &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

# 5. Install Solana CLI
echo "[5/9] Installing Solana CLI..."
if ! command -v solana &> /dev/null; then
    sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi

# 6. Install Anchor
echo "[6/9] Installing Anchor..."
if ! command -v anchor &> /dev/null; then
    cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
    avm install latest
    avm use latest
fi

# 7. Clone and setup HutchMem (Memory System)
echo "[7/9] Setting up HutchMem (Memory System)..."
HUTCHMEM_DIR="$HOME/hutch-mem"
if [ ! -d "$HUTCHMEM_DIR" ]; then
    git clone https://github.com/usehutch/hutch-mem.git "$HUTCHMEM_DIR"
fi
cd "$HUTCHMEM_DIR"
bun install

# 8. Configure Claude Code hooks for memory
echo "[8/9] Configuring Claude Code hooks..."
mkdir -p "$HOME/.claude"
cat > "$HOME/.claude/settings.json" << 'HOOKS_EOF'
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.bun/bin/bun $HOME/hutch-mem/plugin/scripts/worker-service.cjs start"
          },
          {
            "type": "command",
            "command": "$HOME/.bun/bin/bun $HOME/hutch-mem/plugin/scripts/worker-service.cjs hook claude-code context"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.bun/bin/bun $HOME/hutch-mem/plugin/scripts/worker-service.cjs hook claude-code session-init"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.bun/bin/bun $HOME/hutch-mem/plugin/scripts/worker-service.cjs hook claude-code observation"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.bun/bin/bun $HOME/hutch-mem/plugin/scripts/worker-service.cjs hook claude-code summarize"
          }
        ]
      }
    ]
  }
}
HOOKS_EOF

# Replace $HOME with actual path in settings
sed -i "s|\$HOME|$HOME|g" "$HOME/.claude/settings.json"

# 9. Clone and setup Nexus (Agent)
echo "[9/9] Setting up Nexus Agent..."
NEXUS_DIR="$HOME/nexus"
if [ ! -d "$NEXUS_DIR" ]; then
    git clone https://github.com/usehutch/nexus.git "$NEXUS_DIR"
fi
cd "$NEXUS_DIR"
bun install
bun run build

# Create config directory
mkdir -p "$HOME/.nexus"

# Check for credentials
if [ ! -f "$HOME/.nexus/.env" ]; then
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  IMPORTANT: Set up credentials"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "Create ~/.nexus/.env with:"
    echo ""
    echo "  COLOSSEUM_API_KEY=your_api_key"
    echo "  COLOSSEUM_AGENT_ID=your_agent_id"
    echo "  GH_TOKEN=your_github_pat"
    echo ""
    echo "Then run: cd ~/nexus && bun run start"
    echo ""
else
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  Hutch is ready!"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "  Memory:  HutchMem installed at ~/hutch-mem"
    echo "  Agent:   Nexus installed at ~/nexus"
    echo "  Hooks:   Claude Code configured for memory"
    echo ""
    echo "  Start:   cd ~/nexus && bun run start"
    echo "  Status:  tail -f ~/.nexus/nexus.log"
    echo "  Stop:    pkill -f 'bun.*loop'"
    echo ""
fi
