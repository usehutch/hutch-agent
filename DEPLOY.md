# NEXUS Agent - Quick Deploy

## One-Line VM Setup

Run this on a fresh VM to set everything up:

```bash
curl -fsSL https://raw.githubusercontent.com/usehutch/hutch-agent/main/scripts/setup-vm.sh | bash
```

Or if you prefer to inspect first:

```bash
git clone https://github.com/usehutch/hutch-agent.git ~/nexus
cd ~/nexus && ./scripts/setup-vm.sh
```

## Set Credentials

After setup, configure credentials:

```bash
~/nexus/scripts/set-credentials.sh
```

## Start the Agent

```bash
cd ~/nexus && bun run src/cli/index.ts start
```

## Monitor

```bash
tail -f ~/.nexus/nexus.log
```

## What the Setup Script Does

1. Installs bun (if not present)
2. Clones nexus and hutch-mem repositories
3. Installs dependencies
4. Builds TypeScript
5. Creates HutchMem plugin symlinks at `~/.claude/plugins/marketplaces/thedotmack/`
6. Creates config directories
7. Sets up PATH for SSH sessions

## Manual Setup (if script fails)

```bash
# Install bun
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# Clone repos
git clone https://github.com/usehutch/hutch-agent.git ~/nexus
git clone https://github.com/usehutch/hutch-mem.git ~/hutch-mem

# Install and build
cd ~/nexus && bun install && bunx tsc
cd ~/hutch-mem && bun install && bun run build

# Create HutchMem symlinks (CRITICAL)
mkdir -p ~/.claude/plugins/marketplaces/thedotmack
ln -sf ~/hutch-mem/package.json ~/.claude/plugins/marketplaces/thedotmack/package.json
ln -sf ~/hutch-mem/plugin ~/.claude/plugins/marketplaces/thedotmack/plugin

# Create config
mkdir -p ~/.nexus

# Set credentials
cat > ~/.nexus/.env << 'EOF'
COLOSSEUM_API_KEY=your_key_here
COLOSSEUM_AGENT_ID=your_id_here
EOF

# Start agent
cd ~/nexus && bun run src/cli/index.ts start
```

## Troubleshooting

### "bun: command not found" via SSH
Add to `~/.profile`:
```bash
export PATH="$HOME/.bun/bin:$PATH"
```

### HutchMem ENOENT errors
Symlinks not created. Run:
```bash
mkdir -p ~/.claude/plugins/marketplaces/thedotmack
ln -sf ~/hutch-mem/package.json ~/.claude/plugins/marketplaces/thedotmack/package.json
ln -sf ~/hutch-mem/plugin ~/.claude/plugins/marketplaces/thedotmack/plugin
```

### Claude not authenticated
Run `claude` interactively to login first.

### Agent stuck with 0 output
This was fixed - agent now uses streaming JSON. Pull latest:
```bash
cd ~/nexus && git pull && bunx tsc
```
