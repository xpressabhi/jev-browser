#!/usr/bin/env bash
# Install jev-browser for Claude Code: skill + browser policy + `jev` CLI.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec "$ROOT/adapters/install.sh" "$HOME/.claude/skills" "$HOME/.claude/CLAUDE.md"
