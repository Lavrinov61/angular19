# AGENTS.md

These instructions apply to the entire `/var/www/apimain/angular-dev` repository.

Active system, developer, and user messages override this file. If instructions conflict, prefer the more specific file deeper in the tree.

## Project Context

- This is the Angular/API workspace at `/var/www/apimain/angular-dev`.
- A local copy of Codex global context may exist under `./.codex/`. Treat it as private local runtime/config data, not source code.
- For project-context questions and for substantial work, read `./.codex/memories/angular-dev/README.md` and `./.codex/memories/angular-dev/project-rules.md` if present.
- Do not print secrets from `./.codex/`, `.claude/settings.local.json`, environment files, MCP configs, logs, sessions, or copied raw memory unless the user explicitly asks for a secret-bearing value.

## Engineering Approach

- Prefer the production-grade architecture already intended for the feature. Fix the primary implementation path instead of adding temporary fallback layers, parallel ad hoc services, or throwaway wrappers.
- Use temporary workarounds only when explicitly requested or when needed to restore service quickly; document them clearly and remove them in the same task whenever feasible.

## Forbidden Paths

Do not manually edit generated, dependency, or cache paths:

- `dist/`
- `backend/dist/`
- `node_modules/`
- `backend/node_modules/`
- `.angular/`
- `.codex/` runtime data, except when the user explicitly asks to update Codex local config/memory

Work in source paths such as `src/`, `backend/src/`, `rust-api/`, and `mcp-*` when relevant.

## Verification

Before declaring implementation complete, run the narrowest useful check:

- Angular: `npm run build:check`
- Backend TypeScript: `cd backend && npx tsc --noEmit`
- Backend tests: `cd backend && npx vitest run`
- Hookify guardrails: `./.codex/local-marketplaces/angular-dev-hookify/plugins/angular-dev-hookify/scripts/angular-dev-hookify.sh --changed` when available

Do not run a root production build/deploy unless the user explicitly asks for it.

## Angular Rules

The frontend is modern Angular, standalone-first, signal-oriented, and zoneless.

Required for new or touched Angular code:

- `ChangeDetectionStrategy.OnPush`
- built-in template control flow: `@if`, `@for`, `@switch`
- `input()`, `output()`, `viewChild()`, `viewChildren()`, `contentChild()`, `contentChildren()`
- `inject()` instead of constructor dependency injection
- `host: { ... }` instead of `@HostBinding` / `@HostListener`
- native class/style bindings instead of `NgClass` / `NgStyle`
- immutable signal updates

Avoid or forbid:

- `any`, `as any`, broad unsafe casts, and double casts
- new `@NgModule`
- redundant `standalone: true`
- legacy star-prefixed Angular structural directives
- `.toPromise()`
- reintroducing the Angular zone runtime

## Backend And DB Rules

- Use pino and local logger helpers; do not add raw backend `console.*`.
- Kanel-generated database types are the source of truth.
- Use `unknown[]` for SQL params, not `any[]`.
- Put complex DB view/projection types in `backend/src/types/views/`.
- Put JSONB interfaces/unions in `backend/src/types/jsonb/`.
- Do not use inline `db.query<{ ... }>` / `pool.query<{ ... }>` object result types.
- Never use `multer.memoryStorage()`.
- Every `.catch` must log, rethrow, or otherwise handle the error explicitly.

## Git Hygiene

- Preserve user changes already present in the working tree.
- Do not revert unrelated edits.
- Commit your own completed changes after verification.
- Keep commits scoped to the files you intentionally changed for the current task.
- Do not include unrelated or pre-existing user changes in your commits unless the user explicitly asks.
