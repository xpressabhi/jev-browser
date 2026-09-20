#!/usr/bin/env bash
# Install jev-browser for Codex: skill + browser policy + `jev` CLI.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec "$ROOT/adapters/install.sh" "$HOME/.codex/skills" "$HOME/.codex/AGENTS.md"
