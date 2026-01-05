# AGENTS

Guidance for AI coding agents working on this repository. Applies to all files unless a nested AGENTS.md overrides it.

## Project Overview

- Azure DevOps pipeline task for OpenCode AI.
- Two execution modes:
  - **command** (`/oc`, `/opencode`): clone PR branch, run agent, commit/push changes, reply to comment.
  - **review** (`/oc-review`, `/opencode-review`): read-only code review, post inline comments and summary thread.
- Headless review allowed when mode explicitly set to `review` without thread/comment IDs.
- Cross-platform; Node.js ESM; TypeScript source under `src/`.

## Quick Start

- Install deps: `npm install`.
- Build TypeScript: `npm run build`.
- Bundle task artifacts: `npm run build:task`.
- Lint: `npm run lint` (use `lint:fix` to autofix).
- Format: `npm run format` (or `format:check`).
- Package VSIX: `npm run package` (or `package:dev` for private).
- Debug local flow: `npm run debug` (runs `src/debug.ts`).

## Execution Modes

- `mode` input optional; auto-detected from comment if `threadId`+`commentId` provided.
- `command` mode requires trigger comment containing `/oc` or `/opencode`.
- `review` mode trigger: `/oc-review` or `/opencode-review`.
- Explicit `mode` bypasses trigger validation; for headless review also omit `threadId`/`commentId`.
- Summary threads use prefix `## OpenCode Review Summary` and are closed (status fixed).

## Credentials & Env

- Azure DevOps PAT passed via task input `pat`.
- `reviewEnv` exported to child processes for review tools:
  - `AZURE_DEVOPS_ORG`, `AZURE_DEVOPS_PROJECT`, `AZURE_DEVOPS_REPO_ID`, `AZURE_DEVOPS_PR_ID`, `AZURE_DEVOPS_PAT`.
- Avoid adding secrets to code or repo.

## Directory Map

- `src/index.ts`: entry; reads inputs, resolves mode, dispatches to command/review.
- `src/common.ts`: shared types/utilities; mode detection; PR context builder; workspace cleanup.
- `src/opencode.ts`: OpenCode server/client lifecycle; spawns CLI; streams events.
- `src/git.ts`: clone/setup/commit/push helpers.
- `src/command.ts`: command-mode implementation.
- `src/code-review.ts`: review-mode implementation and summary thread posting.
- `src/azure-devops-api.ts`: REST calls for PR data and thread creation.
- `src/prompts/code-review-prompt.ts`: review prompt builder.
- `src/scripts/add-review-comment.mjs`: cross-platform inline comment helper (Node fetch).
- `tasks/opencode/task.json`: pipeline task manifest.

## Build & Packaging

- Preferred workflow: `npm run lint` -> `npm run build` -> `npm run build:task` -> `npm run package`.
- `build:task` uses `build-task.js` (esbuild) and copies `src/scripts/add-review-comment.mjs` into `tasks/opencode`.
- Clean artifacts: `npm run clean`.

## Code Style (Prettier)

- `semi: false`; no semicolons.
- `singleQuote: false`; use double quotes.
- `printWidth: 100`.
- `tabWidth: 2`, spaces only.
- `arrowParens: always`.
- `endOfLine: lf`.

## Linting (ESLint)

- Parser: `@typescript-eslint/parser`; plugins: `@typescript-eslint`, `prettier`.
- Base: `@typescript-eslint/recommended` + `prettier/prettier` error.
- Warnings: `no-explicit-any`, `explicit-function-return-type`, `no-unused-vars` (warn; tests rule unused is error with `_` ignore).
- `no-console` allowed.
- Ignore: `dist/`, `node_modules/`, `coverage/`, `*.vsix`, common config files.

## Editor Config

- UTF-8; LF; trim trailing whitespace; insert final newline.
- Indent: 2 spaces for `*.{js,ts,json}`.
- Markdown keeps trailing spaces (for formatting only when needed).

## TypeScript Config

- `target`/`lib`/`module`: ES2022.
- `moduleResolution: bundler`.
- `rootDir: src`, `outDir: dist`.
- Strict mode on; `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, `noImplicitOverride`.
- `esModuleInterop: true`, `skipLibCheck: true`.
- Source maps + declaration + declarationMap enabled.

## Imports & Modules

- Use ESM with explicit `.js` extensions for local imports.
- Order suggestion: Node built-ins, external deps, local modules.
- Type-only imports allowed; keep them near related runtime imports.
- Prefer named exports; default only when file semantics demand.

## Naming & Structure

- Types/interfaces: `PascalCase`.
- Functions, variables, properties: `camelCase`.
- Constants: `UPPER_SNAKE` only when truly constant across module.
- Files: `kebab-case.ts` or descriptive names aligned to module purpose.

## Error Handling & Logging

- Throw descriptive `Error` with actionable message; avoid silent failures.
- Validate inputs early (`getRequiredInput`, `getRequiredVariable`).
- Use `console.log` for progress; `console.warn` for non-fatal issues; prefer clear, concise messages.
- When posting errors to PR threads, include human-readable summary.

## Git & Workspace

- `skipClone` true requires `workspacePath` provided.
- `cleanupWorkspace` is best-effort; handles locked dirs gracefully.
- Commits/pushes handled by `git.ts`; ensure author config set before committing.

## Review Prompt & Threads

- Review prompt built in `src/prompts/code-review-prompt.ts` with PR data context.
- Summary thread posted closed to avoid clutter; contains `## OpenCode Review Summary` header.
- Inline comments can be added via `src/scripts/add-review-comment.mjs` (requires env vars above).

## Debugging

- Use `npm run debug` to run `src/debug.ts` (untracked by default) via `tsx` for local experiments.
- Ensure required env vars/pat are set when calling APIs.

## Testing

- Jest removed; no test suite currently. Do not add tests unless requested.
- If adding tests later, align with existing lint/prettier/editorconfig settings.

## Contribution Notes

- Keep changes minimal and scoped to the task.
- Follow existing patterns before introducing new ones.
- Avoid introducing new dependencies without necessity.
- Do not commit secrets or sample secrets.

## PR & Comment Triggers

- Command mode replies to triggering comment after actions.
- Review mode posts new PR thread; headless review allowed when `mode=review` and no thread/comment IDs.
- Comment footer includes pipeline link when `organization` and `buildId` provided.

## Packaging & Release

- `npm run package` builds task and creates `.vsix` via `tfx`.
- `package:dev` sets `public: false` in manifest override.
- `publish` uses `tfx extension publish` (requires proper auth context).

## Security & Secrets

- Never log PATs or sensitive values.
- Rely on environment variables/task inputs; do not hardcode credentials.

## Agent Etiquette

- Obey this AGENTS.md for all touched files.
- Prefer surgical edits; avoid noisy reformatting outside your changes.
- Provide concise summaries and mention any skipped validations/tests.

## Line Count Target

- File kept around ~150 lines for readability. Adjust with care if updating.
