<!--
This template encodes the sixteen quality gates from
.specify/memory/constitution.md → "Development Workflow & Quality Gates".
A reviewer who marks "LGTM" without checking these gates is not approving
this PR (constitution §Governance).
-->

## Summary

<!-- One short paragraph. The "why", not the "what" — the diff already shows the what. -->

## Linked work

<!-- Issue / spec / task references. e.g. #123, or specs/NNN-slug/tasks.md → T123, T124. -->

## Sign-off

- [ ] Every commit ends with a `Signed-off-by:` trailer by its author (`git commit -s`), certifying the [Developer Certificate of Origin](https://developercertificate.org/). The `dco` check refuses a pull request with an unsigned commit; `CONTRIBUTING.md` § Sign your commits says how to fix one.

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
- [ ] **10. Multi-tenant isolation** (Principle XI) — tenant-owned data is confined by the framework guard: an ambient TenantContext derived server-side (never from request body/query/headers), a data-layer filter that holds even when a service omits the condition, fail-closed on missing context, every new entity classified (CI check passes) and covered by cross-tenant tests, and any cross-tenant access routed through the audited `withSystemScope` / `withOrgScope` escape hatch. The guard complements, never replaces, `requireAdmin` / `requireCustomer`. Every transacting customer is backed by a non-null Organization (company org for B2B, single-member personal org for B2C) — no new "no-organization" scoping path.
- [ ] **11. Sales-channel scoping** (Principle XII) — channel-scoped reads and channel-bound commercial evaluations (catalog visibility, related/cross/up-sell, promotions, pricing) are confined to the request's resolved sales channel: a channel is always resolved (explicit header/host map, else system-default) and the filter always applied — no path returns the full cross-channel set — and a null/unresolved channel fails closed (never matches a channel-bound record). The `sales_channel_*` bridges are read only through the channel-membership service (`no-unscoped-channel-query` passes), and channel-scoped paths ship with cross-channel tests.
- [ ] **12. Uniform write auditing** (Principle XIII) — sensitive writes (create/update/delete of a domain record) in migrated modules run as named Commands through the Command Bus (the single audit writer) instead of hand-written audit calls; the write + exactly one audit entry + any domain event are co-transactional (commit ⇒ one entry + event once, rollback ⇒ neither); the actor is server-derived from the ambient TenantContext (never request inputs); no double-auditing; and any reversible operation's undo restores captured pre-state all-or-nothing per record with a conflict report, idempotent-safe, itself audited. The command coverage check passes for migrated modules.
- [ ] **13. Entity-agnostic extensibility** (Principle XIV) — a cross-cutting / generic capability keeps its core entity-agnostic: host-specific behavior lives only behind a documented extension point (opaque config the host interprets, or a host-registered adapter), never embedded in the core, which never reads that config for meaning. A generalization of an existing entity-specific system (e.g. `product_attributes`) leaves it the untouched source of truth (reuse the design, not the code; converge later via an adapter, not a rewrite). Runtime extension of core entities is data, not DDL — adding a field is a definition row, never a migration or code deploy — validated per write against its definition, inheriting the host record's tenant scope (never widening); the host owns persistence + audit, the generic layer owns definitions + validation, and definition/option mutations run through the Command Bus (Principle XIII).
- [ ] **14. Per-deployment overlay customization** (Principle XV) — client-specific behavior is delivered through the per-deployment overlay location, never by editing a file under the core modules tree or forking; the core stays deployment-agnostic and the bare-core build keeps working unchanged. Overrides resolve deterministically at build/composition time (identical inputs ⇒ identical resolution + override manifest), a service override is gated by a documented core interface checked at build time (contract drift fails the build), two overlays targeting one unit fail the build (no silent last-wins), a stale/unknown target fails the build, and every build emits an override manifest. Overlay modules register without editing the shared core registry, declare permissions (per-deployment permission-inventory passes), and run under the tenant (XI), channel (XII), and Command-Bus (XIII) guards. The overridable surface is services/routes/config/new modules — schema/entity/migration overrides of existing core units are out of scope (ship new schema as a client-only overlay module).
- [ ] **15. Command-palette discoverability** (Principle XVI) — every module shipping an admin surface declares its palette entries in its **own manifest**: the primary landing surface plus the few highest-value operator actions (curated, not a route dump). Each entry carries the permission code gating the surface it routes to, resolves its label and description from the module's own translation bundle in **every supported admin language** (covered by the automated on-disk bundle check — a malformed bundle fails silently and renders raw keys), and points at a route that exists. No module is reachable from the sidebar only, and no entry is added to a shared hand-maintained list.
- [ ] **16. Module enable/disable completeness** (Principle XVII) — module presence resolves the **conjunction of two orthogonal axes**, never one alone: **platform availability** (lifecycle registry, deployment-owned, CLI) AND **operator activation** (a manifest-declared Setting flipped on the **platform modules screen**, which belongs to no module, business-owned, Admin UI). Gating seams fail closed if either is off or unresolved, and **neither axis overwrites the other** (a platform disable → enable cycle preserves the operator's choice; a Settings write never overrides a platform lockout). Each module declares exactly one activation control in its **own manifest** (never a shared list), rendered on the platform-owned surface rather than on any module's own admin surface; flipping it is an audited Command (Principle XIII) effective across API and worker processes without a redeploy. A module that is off is **absent on all four surfaces** — no services/subscribers/consumers/interceptors running (cross-module callers get the explicit module-disabled error), every owned route rejecting via the route-registration seam, no Admin UI sidebar entry / palette action / widget / tab / settings group / editable configuration, and nothing contributed to the Storefront — with its own activation control the single permitted exception; both frontends resolve this from the server's **effective** enabled-set rather than hard-coding it. A platform-unavailable module is rendered as absent or blocked-with-a-reason, never as merely "switched off". Off is non-destructive and reversible (no dropped data, configuration, bundles, permissions or schema — that is hard uninstall). Non-deactivatable modules are **declared in their manifest** with a stated reason, enforced on the platform axis (the orchestrator refuses to disable them), never hard-coded in the admin app, and never justified by where a screen lives. Dependencies fail closed on and across both axes. A missing registration row resolves to an explicit state and a missing activation value to the manifest default — never "on" by absence. Routes, workers and subscriptions go through the gating wrappers (CI check passes), and an off-state test covers API rejection, admin absence, non-editable configuration, storefront absence and restoration — including the deactivated-while-platform-available case.

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
