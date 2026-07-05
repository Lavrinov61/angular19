# Agent Fleet Rust Plan

## Goal

Build a personal Rust-based agent orchestrator for this server that can manage
full Codex CLI and Claude CLI sessions as named, task-scoped workers.

The tool should replace the current shell-based `codex-fleet` prototype with a
more reliable command, state model, and lifecycle manager while keeping the same
core idea:

- one human/main dispatcher;
- named worker agents created on demand;
- each worker gets its own git worktree and branch;
- durable mailbox and task list;
- tmux-backed interactive CLI processes;
- no patching of Codex or Claude binaries.

This is a personal tool, not a public product.

## Non-Goals

- Do not write a new IDE.
- Do not patch `codex` or `claude` binaries.
- Do not replace VS Code/Cursor/terminal workflows.
- Do not implement a universal plugin platform.
- Do not build a multi-user security model.
- Do not support arbitrary operating systems in v1.

## Working Name

Use `fleet` for the Rust binary.

Current shell prototype remains `codex-fleet` until the Rust CLI can replace it.

## Target UX

Basic flow:

```bash
fleet doctor
fleet start
fleet team create "починить auth profile completion"
fleet spawn codex auth-backend "исследуй backend auth/profile endpoints"
fleet spawn codex auth-ui "исследуй Angular auth/profile UI"
fleet spawn claude review-auth "read-only review after workers finish"
fleet send auth-backend "не трогай frontend; ownership backend/src/routes/auth*"
fleet inbox
fleet status
fleet diff auth-backend
fleet collect auth-backend
fleet stop auth-backend
```

Default behavior:

- `fleet` attaches to the main tmux window.
- `fleet start` starts only `main` plus the mailbox daemon.
- Worker agents are not pre-created.
- `fleet spawn` creates narrow task-specific workers.
- Messages to `main` are stored in inbox, not pasted into a separate main CLI.

## Architecture

### Components

```text
fleet Rust binary
  ├─ config loader
  ├─ state store
  ├─ git worktree manager
  ├─ tmux adapter
  ├─ provider adapter
  │   ├─ codex-cli
  │   └─ claude-cli
  ├─ mailbox dispatcher
  ├─ task manager
  └─ diagnostics/doctor
```

### Execution Layer

Use `tmux` for v1. Do not implement PTY management yet.

Reasons:

- tmux is already installed and reliable on the server;
- detached sessions survive SSH disconnects;
- existing interactive Codex/Claude TUIs keep working;
- fewer Rust dependencies and fewer terminal edge cases.

Later, a `portable-pty` backend can be added only if tmux becomes limiting.

### State Store

Use SQLite.

Location:

```text
~/.local/state/agent-fleet/state.sqlite
```

Config:

```text
~/.config/agent-fleet/config.toml
```

Logs:

```text
~/.local/state/agent-fleet/logs/
```

## Config Sketch

```toml
default_repo = "angular-dev"

[repos.angular-dev]
path = "/var/www/apimain/angular-dev"
worktree_parent = "/var/www/apimain"
worktree_prefix = "angular-dev-agent"
base_ref = "HEAD"

[providers.codex]
cmd = "codex"
args = ["--dangerously-bypass-approvals-and-sandbox"]

[providers.claude]
cmd = "claude"
args = []

[tmux]
session_prefix = "fleet"
```

## Data Model

Minimum SQLite tables:

- `repos`
  - `id`
  - `name`
  - `path`
  - `worktree_parent`
  - `worktree_prefix`
  - `base_ref`
- `teams`
  - `id`
  - `repo_id`
  - `name`
  - `created_at`
  - `status`
- `agents`
  - `id`
  - `team_id`
  - `name`
  - `provider`
  - `worktree_path`
  - `branch`
  - `tmux_window`
  - `status`
  - `created_at`
- `tasks`
  - `id`
  - `team_id`
  - `owner_agent_id`
  - `title`
  - `status`
  - `created_at`
  - `updated_at`
- `messages`
  - `id`
  - `team_id`
  - `from_agent_id`
  - `to_agent_id`
  - `body`
  - `created_at`
- `message_deliveries`
  - `message_id`
  - `agent_id`
  - `status`
  - `delivered_at`
  - `read_at`

Statuses:

- agents: `starting`, `ready`, `working`, `blocked`, `stopped`, `failed`
- tasks: `todo`, `in_progress`, `blocked`, `review`, `done`
- deliveries: `queued`, `delivered`, `read`, `failed`, `stored_only`

## Command Surface

### Core

```bash
fleet init
fleet doctor
fleet start [repo]
fleet stop
fleet attach [main|agent-name]
fleet status
```

### Teams

```bash
fleet team create "task description"
fleet team current
fleet team list
fleet team show [team-id]
```

### Agents

```bash
fleet spawn codex auth-backend "task"
fleet spawn claude review-auth "task"
fleet agents list
fleet stop auth-backend
fleet forget auth-backend
```

### Mailbox

```bash
fleet send auth-backend "message"
fleet broadcast "message"
fleet inbox
fleet inbox --unread --ack
fleet logs auth-backend
```

### Tasks

```bash
fleet task add auth-backend "task title"
fleet task set 1 in_progress
fleet task list
```

### Git Integration

```bash
fleet diff auth-backend
fleet collect auth-backend
fleet cherry-pick auth-backend
```

`collect` should export patches by default. `cherry-pick` can be added after
diff/review flow is stable.

## Provider Adapters

### Codex Provider

Responsibilities:

- start `codex` in the agent worktree;
- pass configured args;
- set environment:
  - `FLEET_AGENT_NAME`
  - `FLEET_TEAM_ID`
  - `FLEET_REPO_ID`
  - `FLEET_STATE_DB`
- send prompts through tmux paste;
- avoid depending on full TUI parsing.

### Claude Provider

Responsibilities:

- start `claude` in the agent worktree;
- pass configured args;
- use the same mailbox/task protocol prompt;
- do not assume Claude native Team tools are available unless explicitly
  configured.

## Bootstrap Prompt

Every spawned worker gets a generated bootstrap prompt:

```text
You are named agent <name> in team <team>.
Provider: <codex|claude>.
Worktree: <path>.
Branch: <branch>.
Task: <task>.

Load:
- global agent instructions;
- repository AGENTS.md;
- project memory/rules if present;
- team brief;
- task list;
- unread inbox.

Rules:
- communicate in Russian;
- do not print secrets;
- edit only owned files;
- report blockers to main through `fleet send main ...`;
- commit scoped changes after verification when implementation is complete.
```

## Implementation Phases

### Phase 0: Keep Shell Prototype Stable

- Keep current `codex-fleet` as the fallback.
- Stop adding complex behavior to shell scripts.
- Use shell prototype only to validate desired commands.

### Phase 1: Rust Skeleton

- Create a new repo or crate:

```text
/var/www/apimain/agent-fleet
```

- Add:
  - `clap` command parsing;
  - `tracing` logging;
  - config loading from TOML;
  - `doctor`;
  - basic error handling with `anyhow` or `miette`.

Acceptance:

```bash
fleet doctor
fleet --help
```

### Phase 2: State And Config

- Add SQLite store.
- Add migrations.
- Add config model.
- Add repo registration.

Acceptance:

```bash
fleet init
fleet repo list
fleet team create "smoke"
fleet team current
```

### Phase 3: tmux And Main Session

- Start/stop tmux session.
- Start main provider CLI.
- Attach to windows.

Acceptance:

```bash
fleet start angular-dev
fleet attach
fleet status
```

### Phase 4: Spawn Codex Agents

- Create named worktree and branch.
- Start Codex in tmux window.
- Send bootstrap prompt.
- Store agent state in SQLite.

Acceptance:

```bash
fleet spawn codex smoke-codex "ответь готов"
fleet status
fleet logs smoke-codex
```

### Phase 5: Durable Mailbox

- Store messages in SQLite.
- Deliver messages to agent tmux windows.
- Store delivery/read markers.
- Keep messages to `main` stored-only by default.

Acceptance:

```bash
fleet send smoke-codex "ping"
fleet inbox
fleet inbox --ack
```

### Phase 6: Tasks

- Add task CRUD.
- Link task to owner agent.
- Include task updates in inbox.

Acceptance:

```bash
fleet task add smoke-codex "check status"
fleet task set 1 done
fleet task list
```

### Phase 7: Git Review Flow

- Show agent status and diff.
- Export patches.
- Optional cherry-pick.

Acceptance:

```bash
fleet diff smoke-codex
fleet collect smoke-codex
```

### Phase 8: Claude Provider

- Add provider config for `claude`.
- Spawn Claude agents the same way as Codex agents.
- Keep shared mailbox/task behavior provider-neutral.

Acceptance:

```bash
fleet spawn claude smoke-claude "прочитай правила и ответь готов"
fleet send smoke-claude "ping"
```

## Maintenance Strategy

- Treat Codex and Claude as external commands, not libraries.
- Keep provider-specific code small.
- Prefer stable process behavior over TUI parsing.
- Use `fleet doctor` after CLI upgrades.
- Keep all state migrations explicit.
- Keep the shell prototype until Rust covers the same daily workflow.

Upgrade smoke:

```bash
fleet doctor
fleet team create "upgrade smoke"
fleet spawn codex smoke-codex "ответь готов"
fleet send smoke-codex "ping"
fleet stop smoke-codex
```

## Open Decisions

- State location: XDG paths vs `~/.fleet`.
- Whether `fleet start` should always start a main Codex window.
- Whether main should be a human-only inbox or a real provider-backed agent.
- Whether to keep tmux forever or add a Rust PTY backend later.
- Whether to support automatic commit collection or keep it manual.

## First Build Session Checklist

1. Create `/var/www/apimain/agent-fleet`.
2. Initialize Rust binary crate.
3. Add `clap`, `serde`, `toml`, `tracing`, `rusqlite` or `sqlx`.
4. Implement config loading.
5. Implement `fleet doctor`.
6. Implement initial SQLite migrations.
7. Add `fleet team create/current/list`.
8. Stop before spawning agents unless the state model is clean.
