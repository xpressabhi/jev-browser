---
title: Set up jev-browser
description: Agent instructions for installing jev-browser (Jev decisions for any browser harness). Fetch this file and follow the steps for the harness you are running in.
---

# Set up jev-browser

You are an agent installing **jev-browser** for the harness you are running in.
Follow these steps in order. Ask the human only for the TypeSafe API key.

Repo: <https://github.com/xpressabhi/jev-browser>

## 0. Stop if it is already installed

If the `jev` tools (`jev_observe`, `jev_step`) or the `jev` CLI are already
available in this session, tell the human it is already set up and stop.

## 1. Clone

```sh
git clone https://github.com/xpressabhi/jev-browser ~/.local/share/jev-browser
```

If the directory already exists, `git -C ~/.local/share/jev-browser pull` instead.

## 2. Install for this harness

Pick the branch that matches the harness you are running in. Do not install
every adapter.

- **Claude Code** — you have `~/.claude/` or a Skill tool:

  ```sh
  ~/.local/share/jev-browser/adapters/claude/install.sh
  ```

  Writes the skill to `~/.claude/skills/jev-browser/`, appends the browser
  policy to `~/.claude/CLAUDE.md`, and puts a `jev` wrapper in `~/.local/bin`.
  Ensure `~/.local/bin` is on PATH.

- **Codex** — you have `~/.codex/`:

  ```sh
  ~/.local/share/jev-browser/adapters/codex/install.sh
  ```

  Same, targeting `~/.codex/skills/` and `~/.codex/AGENTS.md`.

- **OpenCode** — you have the `opencode` tools or an `opencode.jsonc`:
  add the absolute repo path to the `plugins` array in the opencode config
  (`opencode.jsonc` / `opencode.json`), then tell the human to restart OpenCode.

  ```jsonc
  { "plugins": ["/Users/<you>/.local/share/jev-browser"] }
  ```

- **Anything else** — make the CLI available, then wire the skill:

  ```sh
  npm --prefix ~/.local/share/jev-browser link
  ```

  Copy `~/.local/share/jev-browser/skill/SKILL.md` into that harness's skills
  or rules directory, or paste `adapters/policy.md` into its system rules.

The install scripts are idempotent; re-running them is safe.

## 3. TypeSafe API key

Ask the human for their TypeSafe API key (`TYPESAFE_API_KEY`). Write it to a
file — never into the repo, never into shell history, and never echo the value
back to the human:

```sh
mkdir -p ~/.config/jev-browser
printf 'TYPESAFE_API_KEY=%s\n' "$KEY" > ~/.config/jev-browser/.env
chmod 600 ~/.config/jev-browser/.env
```

That file is read automatically by the CLI (and by the OpenCode plugin). A
`./.env` in the working directory works too; real environment variables win
over both. The key is the only required secret — text values come from the
session model or a host key.

## 4. Verify

```sh
jev observe --snapshot /dev/null --url u --title t
```

This should print one JSON line, not an error about a missing command or file.
For a stricter check that the key resolves, run the same pipe with a real
snapshot and goal:

```sh
jev observe --snapshot /dev/null --url u --title t | jev decide --goal test --page -
```

The stricter check reaches the TypeSafe API; if it answers with an HTTP status
error, the key is missing or invalid. If it answers `{"operation":"BLOCKED"…}`
or similar, setup is complete.

## 5. Tell the human

Report: which harness was detected, what was installed, where the key was
stored, and whether verification passed. Mention that browser work will now
route through jev-browser automatically.
