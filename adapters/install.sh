#!/usr/bin/env bash
# Shared installer for the jev-browser skill. Called by adapters/<harness>/install.sh
# with the harness skill directory. Idempotent: safe to re-run after a git pull.
set -euo pipefail

SKILL_DIR="${1:?usage: install.sh <skills-dir> [rules-file]}"
RULES_FILE="${2:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKER="# >>> jev-browser"
END_MARKER="# <<< jev-browser"

mkdir -p "$SKILL_DIR/jev-browser"
cp "$ROOT/skill/SKILL.md" "$SKILL_DIR/jev-browser/SKILL.md"
echo "skill  → $SKILL_DIR/jev-browser/SKILL.md"

if [ -n "$RULES_FILE" ]; then
  mkdir -p "$(dirname "$RULES_FILE")"
  touch "$RULES_FILE"
  if grep -qF "$MARKER" "$RULES_FILE"; then
    echo "rules  → already present in $RULES_FILE"
  else
    {
      printf '\n%s\n' "$MARKER"
      cat "$ROOT/adapters/policy.md"
      printf '%s\n' "$END_MARKER"
    } >> "$RULES_FILE"
    echo "rules  → appended to $RULES_FILE"
  fi
fi

# `jev` wrapper on PATH. A wrapper, not a symlink: the CLI resolves its
# siblings through its own location.
BIN_DIR="${JEV_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/jev" <<EOF
#!/usr/bin/env bash
exec node --experimental-strip-types "$ROOT/src/cli.ts" "\$@"
EOF
chmod +x "$BIN_DIR/jev"
echo "cli    → $BIN_DIR/jev"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "note   → add $BIN_DIR to PATH if it is not already there" ;;
esac
