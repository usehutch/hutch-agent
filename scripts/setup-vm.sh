#!/bin/bash
# NEXUS Agent VM Setup Script
# Run this on a fresh VM to set up everything needed

set -e  # Exit on error

echo "═══════════════════════════════════════════════════════════"
echo "  NEXUS Agent VM Setup"
echo "═══════════════════════════════════════════════════════════"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 1. Install bun if not present
if ! command -v bun &> /dev/null; then
    log_info "Installing bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
else
    log_info "bun already installed"
fi

# Ensure bun is in PATH for this script
export PATH="$HOME/.bun/bin:$PATH"

# 2. Clone repositories if not present
cd "$HOME"

if [ ! -d "$HOME/nexus" ]; then
    log_info "Cloning nexus repository..."
    git clone https://github.com/usehutch/hutch-agent.git nexus
else
    log_info "nexus already exists, pulling latest..."
    cd "$HOME/nexus" && git pull
fi

if [ ! -d "$HOME/hutch-mem" ]; then
    log_info "Cloning hutch-mem repository..."
    git clone https://github.com/usehutch/hutch-mem.git
else
    log_info "hutch-mem already exists, pulling latest..."
    cd "$HOME/hutch-mem" && git pull
fi

# 3. Install dependencies
log_info "Installing nexus dependencies..."
cd "$HOME/nexus"
bun install

log_info "Installing hutch-mem dependencies..."
cd "$HOME/hutch-mem"
bun install

# 4. Build projects
log_info "Building nexus..."
cd "$HOME/nexus"
bunx tsc

log_info "Building hutch-mem..."
cd "$HOME/hutch-mem"
bun run build 2>/dev/null || log_warn "hutch-mem build had warnings (may be ok)"

# 5. Set up HutchMem plugin symlinks
log_info "Setting up HutchMem plugin symlinks..."
PLUGIN_DIR="$HOME/.claude/plugins/marketplaces/thedotmack"
mkdir -p "$PLUGIN_DIR"

# Create symlinks for all necessary files
ln -sf "$HOME/hutch-mem/package.json" "$PLUGIN_DIR/package.json"
ln -sf "$HOME/hutch-mem/plugin" "$PLUGIN_DIR/plugin"

log_info "HutchMem plugin symlinks created at $PLUGIN_DIR"

# 6. Create nexus config directory
log_info "Creating nexus config directory..."
mkdir -p "$HOME/.nexus"

# 7. Create .env file template if it doesn't exist
ENV_FILE="$HOME/.nexus/.env"
if [ ! -f "$ENV_FILE" ]; then
    log_info "Creating .env template..."
    cat > "$ENV_FILE" << 'EOF'
# Colosseum Agent Hackathon Credentials
# Fill these in after registering at https://agents.colosseum.com
COLOSSEUM_API_KEY=
COLOSSEUM_AGENT_ID=
COLOSSEUM_CLAIM_CODE=
COLOSSEUM_VERIFICATION_CODE=

# GitHub token for commits (optional)
GH_TOKEN=
EOF
    log_warn ".env file created at $ENV_FILE - please fill in credentials"
else
    log_info ".env file already exists"
fi

# 8. Create working directory for agent output
log_info "Creating agent working directory..."
mkdir -p "$HOME/nexus-acp"

# 9. Initialize git in working directory if needed
if [ ! -d "$HOME/nexus-acp/.git" ]; then
    log_info "Initializing git in nexus-acp..."
    cd "$HOME/nexus-acp"
    git init
    git config user.email "hutch@agent.ai"
    git config user.name "Hutch Agent"
fi

# 10. Add bun to PATH permanently
if ! grep -q '.bun/bin' "$HOME/.bashrc" 2>/dev/null; then
    log_info "Adding bun to PATH in .bashrc..."
    echo 'export PATH="$HOME/.bun/bin:$PATH"' >> "$HOME/.bashrc"
fi

# 11. Add bun to PATH for non-interactive shells (SSH)
PROFILE_FILE="$HOME/.profile"
if ! grep -q '.bun/bin' "$PROFILE_FILE" 2>/dev/null; then
    log_info "Adding bun to PATH in .profile..."
    echo 'export PATH="$HOME/.bun/bin:$PATH"' >> "$PROFILE_FILE"
fi

# 12. Verify Claude CLI is available
if command -v claude &> /dev/null; then
    log_info "Claude CLI found: $(claude --version 2>/dev/null || echo 'version unknown')"
else
    log_warn "Claude CLI not found - you may need to run 'claude' to login first"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Setup Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Edit ~/.nexus/.env and add your Colosseum credentials"
echo "  2. Run 'claude' to login if not already authenticated"
echo "  3. Start the agent: cd ~/nexus && bun run src/cli/index.ts start"
echo ""
echo "To monitor the agent:"
echo "  tail -f ~/.nexus/nexus.log"
echo ""
