# Quickstart: validating CRM — Sales Opportunities

**Feature**: `specs/143-crm-sales-opportunities/`

How to prove each slice works. Contracts are in `contracts/`, the schema in `data-model.md`.

## Before anything

```bash
bash scripts/setup-worktree.sh           # in a fresh worktree; never symlink node_modules
pnpm run build:packages                  # every package resolves at ./dist — a precondition
pnpm run dev:infra                       # Postgres, Redis, Meilisearch for integration tests
```

**Do not run `db:fresh`, `db:reset`, `setup` or any `module:*` command unprefixed** — they
read `backend/.env` and act on the development database. The vitest harness redirects to the
test database on its own; everything below goes through it.

After editing any package (including `packages/contracts` and `packages/modules/crm`), rebuild
that package before running a test: `tsc` reads sources through `paths`, the test run reads
`dist`, and a stale `dist` makes the two disagree.

```bash
pnpm --filter @endora-commerce/contracts run build
pnpm --filter @endora-commerce/mod-crm run build
```

## The MVP walk (User Story 1) — the owner's success criterion

Automated, and the definition of "P1 is done":

```bash
pnpm --filter backend exec vitest run test/integration/crm/workflow-walk.test.ts
```

It must do, in one test, against the real database and the real `orders` module:

1. read the seeded workflow; add a status `in_delivery`, transitions into and out of it;
2. `PUT /order-status-mappings` with two forward mappings to two real Order statuses that the
   seeded Order graph connects from the test Order's starting status;
3. `POST /opportunities` (title + test Organization) → status `new`, a number;
4. `POST /opportunities/:id/links` with an existing Order of that Organization;
5. `POST /opportunities/:id/transition` along every edge up to `won`;
6. assert after each mapped step that **the Order row's status is the mapped status**, read
   through `orderReadPort`, and that the response's `propagation[0].outcome` is `applied`;
7. assert the Opportunity is `closedKind: 'won'` with a `closedAt`;
8. assert a transition the graph lacks answers 409 `CRM_INVALID_TRANSITION` and leaves both
   the Opportunity and the Order unchanged;
9. assert a mapped Order status the Order graph does not permit yields HTTP 200, the
   Opportunity moved, and `propagation[0].outcome === 'not_permitted'` with a `detail`;
10. register a guard through `opportunityTransitionGuardRegistry` that vetoes one transition,
    assert 409 `CRM_TRANSITION_VETOED` with the guard's sentence; subscribe to a templated
    `.after` event and assert it fired exactly once for an applied transition.

By hand, in the admin (`pnpm run dev`): *CRM → Workflow* to configure; *CRM → Opportunities →
New*; link an Order on the Opportunity's *Overview*; use the status control; open the Order in
*Sales → Orders* and see its status.

## Per-story checks

| Story | Command | What it proves |
| --- | --- | --- |
| Foundation | `vitest run test/integration/crm/off-state.test.ts` | absent on every surface while off, restored after |
| Foundation | `vitest run test/integration/crm/migration.test.ts` | tables, constraints, seeded workflow |
| Foundation | `vitest run test/integration/crm/tenant-isolation.test.ts` | a scoped admin gets 404 for another Organization's Opportunity and children |
| US1 | `vitest run test/contract/crm/` | every US1 endpoint against its Zod schema |
| US2 | `vitest run test/integration/crm/reverse-mapping.test.ts` | any/all rule, one-hop loop prevention |
| US3 | `vitest run test/integration/crm/default-assignee.test.ts` | the three-step default |
| US4 | `vitest run test/integration/crm/comments.test.ts` | author-only edit, immutable messages, notification degrade |
| US5 | `vitest run test/integration/crm/attachments.test.ts` | link, list, library deletion protection |
| US6 | `vitest run test/integration/crm/tags.test.ts` | CRUD, AND filter |
| US7 | `pnpm --filter admin exec vitest run test/modules/crm/board.test.tsx` | columns, permitted vs refused drop, "Move to" parity |
| US8 | `vitest run test/integration/crm/value.test.ts` | counting set, single-count of converted quotes, currency exclusion |
| US9 | `vitest run test/integration/crm/auto-create.test.ts` | settings on/off, idempotent redelivery |
| US10 | `vitest run test/integration/crm/create-from-opportunity.test.ts` and the `orders` / `quote_requests` tests named in `contracts/foreign-module-changes.md` | linked by `origin`; owners unchanged without CRM |
| US11 | `vitest run test/integration/crm/history.test.ts` | every Command appears; out-of-scope 404 |
| US12 | `vitest run test/integration/crm/references.test.ts` | extraction, resolution, unavailable targets |
| US13 | `vitest run test/integration/crm/analytics.test.ts` | each figure against a hand-computed fixture |
| US14 | `vitest run test/integration/crm/ports.test.ts` | read/transition ports, gated while off |

(All `vitest run` lines are `pnpm --filter backend exec vitest run …` unless they say
otherwise.)

## Before calling any story done

Run what the `quality` job runs, not a subset — the five checks a brief names are not the
forty the job holds:

```bash
pnpm -r run typecheck && pnpm -r run lint
pnpm --filter backend run test:unit:fast
pnpm --filter '!backend' run test                      # the packages, mod-crm included
pnpm --filter backend run composer:check && pnpm --filter backend run manifests:check
pnpm --filter backend run overlay:check
pnpm run check:naming && pnpm run check:language
for c in module-boundary port-dependencies port-catches subscribe-seam entry-presence \
         command-coverage off-state-coverage bundle-pairing module-docs admin-surface \
         admin-zones action-route-permissions transaction-context queue-names \
         default-language-prose error-translations docs-translations; do
  pnpm --filter backend run "check:$c" || break
done
pnpm --filter backend run i18n:hardcoded
pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts \
  test/unit/_i18n/registered-bundles-shape.test.ts test/unit/db/fk-dependency-drift.test.ts \
  test/unit/db/migrations-registry.test.ts test/unit/db/module-graph.test.ts \
  test/contract/kernel/harness-parity.test.ts
pnpm --filter backend exec tsx scripts/check-release-intent.ts --since origin/master
pnpm --filter docs run build                            # when a docs page changed
```

`check:release-intent` is run **with `--since origin/master`**, the way CI runs it; bare, it
answers a different question and prints the same green.

The list of checks is the `quality` job's to state: read `.github/workflows/` for the current
set rather than trusting this block, which was correct on 2026-10-05.

A merge-request pipeline does not run the contract and integration suites (owner ruling
D-198) — a local green on the targeted files above is the only evidence before merge, so
report it with its output.
