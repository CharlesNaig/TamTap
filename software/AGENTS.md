# Agent Instructions

This file is the root operating guide for agent work in this repository.

## Priority Order

When instructions conflict, follow this order:

1. `.github/agents/*.agent.md` for the task-specific agent role
2. `.github/instructions/*.instructions.md`
3. `.github/copilot-instructions.md`
4. `CLAUDE.md`
5. Existing code patterns in `src/`

If a GitHub agent file gives a task-specific rule, it overrides this file.

## Routing Rule

Use the GitHub agent files as the source of truth for specialist behavior:

- `@delegator` routes work
- `@architect` handles design
- `@analyzer` handles read-only code mapping
- `@debugger` handles bug fixing
- `@test-gen` handles tests
- `@refactor` handles structure and cleanup
- `@security` handles auth and validation
- `@database` handles schemas and data modeling
- `@api-builder` handles API contracts
- `@decomposer` handles large task breakdowns

Do not bypass a specialist agent rule when one exists in `.github/agents/`.

## Repository Baseline

- This is a Discord.js v14 hybrid bot project.
- JavaScript ES modules only in `src/`.
- Commands, events, and components use class-based loaders.
- Prefer `ctx.sendTypedMessage()` and the triple output format: `embed`, `componentsv2`, and `message`.
- Use `this.client.embed()` for embeds and `resolveColor()` for V2 accent colors.
- Use `this.client.logger` instead of `console.log` or `console.error`.

## Instruction Sources

Prefer the repo-specific GitHub instruction files over memory:

- Discord bot conventions: `.github/instructions/discord-bot.instructions.md`
- Code quality rules: `.github/instructions/code-quality.instructions.md`
- Database rules: `.github/instructions/database.instructions.md`
- Environment/config rules: `.github/instructions/environment-config.instructions.md`
- Embed/UI rules: `.github/instructions/embed-design.instructions.md`
- Context tracking: `.github/instructions/context-tracking.instructions.md`

# Universal Agent Entry

This repository uses the universal agent system. Any coding agent working here must treat these files as the source of truth before editing:

1. Read `/agent-system/base/GLOBAL-RULES.md`
2. Read `/agent-system/base/BASE-SKILLS.md`
3. Read `/agent-system/base/CONTEXT-PROTOCOL.md`
4. Read `/agent-system/base/OBSIDIAN-BRAIN-PROTOCOL.md`
5. For code work, also read `/agent-system/base/CODE-QUALITY.md`
6. Read the relevant skill file from `/agent-system/skills/`

Before editing, check `CONTEXT.md` and any relevant `.context/` snapshots for project state.

After any file changes, the final action must update:

- `CONTEXT.md`
- `.context/YYYY-MM-DD-HHMM-short-session-title.md`
- The Obsidian Brain entry and `Project Index.md` under `C:\Users\Charles\Documents\Obsidian Vault\My Brain`

If the Obsidian vault is unavailable, create the pending brain entry in `.context/obsidian-brain-pending/` and state where it must be copied.


## Conflict Handling

If two repo instructions conflict, use the more specific file or the one under `.github/agents/` that directly matches the task.
If no repo instruction covers the case, follow the existing codebase pattern and keep the implementation minimal.

## Brain-First Workflow

Before starting any file-changing task, the agent must:

1. Identify the project name and type.
2. Locate the matching Obsidian Brain project folder.
3. Read that folder's `Project Index.md` if it exists.
4. Read the latest 3 to 5 files inside `Brain Changes/` when available.
5. Use those notes together with local `CONTEXT.md` and `.context/` snapshots before planning or editing.

After completing file changes, the agent must:

1. Update `CONTEXT.md`.
2. Create a `.context/` session snapshot.
3. Create a new Obsidian Brain change entry.
4. Update the matching Obsidian `Project Index.md`.
5. If the vault is unavailable, create a fallback entry in `.context/obsidian-brain-pending/`.
