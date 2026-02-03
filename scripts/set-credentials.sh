#!/bin/bash
# Set Colosseum credentials for NEXUS Agent
# Usage: ./set-credentials.sh
#
# This script prompts for credentials interactively.
# You can also manually edit ~/.nexus/.env

set -e

ENV_FILE="$HOME/.nexus/.env"
mkdir -p "$HOME/.nexus"

echo "═══════════════════════════════════════════════════════════"
echo "  NEXUS Agent Credentials Setup"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if credentials already exist
if [ -f "$ENV_FILE" ] && grep -q "COLOSSEUM_API_KEY=." "$ENV_FILE" 2>/dev/null; then
    echo "Credentials already exist in $ENV_FILE"
    read -p "Overwrite? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo "Keeping existing credentials."
        exit 0
    fi
fi

echo "Enter your Colosseum Agent Hackathon credentials."
echo "Get these from https://agents.colosseum.com after registering."
echo ""

read -p "COLOSSEUM_API_KEY: " API_KEY
read -p "COLOSSEUM_AGENT_ID: " AGENT_ID
read -p "COLOSSEUM_CLAIM_CODE (optional): " CLAIM_CODE
read -p "COLOSSEUM_VERIFICATION_CODE (optional): " VERIFY_CODE
read -p "GH_TOKEN (optional, for git commits): " GH_TOKEN

cat > "$ENV_FILE" << EOF
# Colosseum Agent Hackathon Credentials
COLOSSEUM_API_KEY=${API_KEY}
COLOSSEUM_AGENT_ID=${AGENT_ID}
COLOSSEUM_CLAIM_CODE=${CLAIM_CODE}
COLOSSEUM_VERIFICATION_CODE=${VERIFY_CODE}

# GitHub token for commits
GH_TOKEN=${GH_TOKEN}
EOF

chmod 600 "$ENV_FILE"

echo ""
echo "Credentials saved to $ENV_FILE"
echo ""
echo "You can now start the agent:"
echo "  cd ~/nexus && bun run src/cli/index.ts start"
echo ""
