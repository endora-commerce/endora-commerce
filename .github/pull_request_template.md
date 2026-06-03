<!--
This template encodes the nine quality gates from
.specify/memory/constitution.md → "Development Workflow & Quality Gates".
A reviewer who marks "LGTM" without checking these gates is not approving
this PR (constitution §Governance).
-->

## Summary

<!-- One short paragraph. The "why", not the "what" — the diff already shows the what. -->

## Linked work

<!-- Issue / spec / task references. e.g. specs/001-…/tasks.md → T123, T124. -->

## Quality gates

- [ ] **1. Constitution Check** — `/speckit.plan` Constitution Check is complete; no unjustified violations.
- [ ] **2. Tests** — new backend modules carry unit + contract + integration tests (Principle III). Full suite passes locally and in CI.
- [ ] **3. Type check & lint** — `pnpm -r run typecheck` and `pnpm -r run lint` are clean.
- [ ] **4. Naming conventions** (Principle VI) — `pnpm run check:naming` is clean.
- [ ] **5. Working language** (Principle VIII) — `pnpm run check:language` is clean. Inline **comments inside source files** and every page authored under the **`/docs/` documentation site** are English. Identifiers, string literals, specs, plans, tasks, the README, this PR description, commit messages, and code-review prose MAY be in any language.
- [ ] **6. Docs sync** — README and the docs site are updated alongside any new module or infrastructure-relevant change.
- [ ] **7. Dependency justification** (Principle IV) — every new runtime dependency added by this PR has a one-paragraph rationale below.
- [ ] **8. UI reuse** (Principle IX) — frontend changes reuse existing Admin UI / Storefront UI components and layouts; any net-new component or layout carries a UX justification (missing pattern, primitives evaluated, why composition failed).
- [ ] **9. Async queue consumers** (Principle X) — queue-backed async work uses a durable queue with atomic claim + idempotent handlers (safe at N ≥ 2 instances), the producer only enqueues, and the consumer is a separable worker entrypoint (never an in-process `setInterval` sweeper). Separate process is the production default; co-locating low-volume work carries a one-sentence justification.

### New runtime dependencies (gate 7)

<!--
For each new runtime dep, write one paragraph explaining why an existing
library does not solve the problem. Delete this section if no new deps
were added.

Example:

- `@asteasolutions/zod-to-openapi` (^8.5.0) — generates the live OpenAPI
  document from the same Zod schemas Fastify validates against, so the
  spec cannot drift from the runtime. Alternatives evaluated: hand-written
  OpenAPI YAML (drifts), `@anatine/zod-openapi` (no v3.1 support).
-->

_None._

## How to verify

<!-- Concrete commands a reviewer can run against this branch to confirm the change works. -->

## Risks / out-of-scope

<!-- Anything explicitly deferred. -->
