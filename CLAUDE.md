# CLAUDE.md

The project instructions live in `AGENTS.md` — the single source of truth shared by every AI
coding tool used in this repository. It is imported here:

@AGENTS.md

Do not copy content from `AGENTS.md` into this file. If a rule applies to the repository, it
belongs there; only Claude Code-specific wiring belongs below.

## Claude Code specifics

- **Subagents** — `.claude/agents/`: `endora-commerce-architect` (specs and plans),
  `endora-commerce-dev` (implementation), `endora-commerce-designer` (UI/UX design and
  audits), `endora-commerce-product-owner` (spec ↔ code consistency, `docs/`). The Cursor
  equivalents live in `.cursor/agents/`; keep the two sets in sync when a role changes.
- **Skills** — `.claude/skills/speckit-*` implement the feature workflow
  (`/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement`). The Cursor
  ports are in `.cursor/commands/`, the Codex ports in `.agents/skills/`.
  `.claude/skills/ux-laws/` holds the UX rules for `endora-commerce-designer`; it is
  deliberately **not** duplicated per tool — the Cursor agent reads that path directly.
- **Agent context regeneration** — `/speckit.plan` runs
  `.specify/scripts/bash/update-agent-context.sh`, which is pinned to write into `AGENTS.md`
  regardless of the tool it was invoked from. That is deliberate: it is what stops this file,
  `AGENTS.md` and `.cursor/rules/specify-rules.mdc` from drifting into three divergent copies
  of the same guidelines, as they had before 2026-07-31.
