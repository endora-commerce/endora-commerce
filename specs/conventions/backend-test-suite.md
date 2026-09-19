# The backend test suite — which command, what it skips, and what guards it

**Open this before running or changing anything in `backend/test/`, and whenever a suite result
needs to mean something.** It carries which test command to run and why, the
unit files that talk to a live service, the five-shard serialisation and the host
measurement behind it, per-invocation database and Redis isolation, and the
workspace-resolution guard that refuses a run reading another checkout. One of the bodies
`AGENTS.md` routes to; it is the single home for these rules, so never restate them in
`AGENTS.md` or in a tool-specific pointer file.

## Which backend test command to use

**The command.** `test:unit:fast` (config: `backend/vitest.unit.config.ts`)
is the one to run while you iterate and the one CI runs on every backend MR as `test:backend:unit`,
with no service containers. **The suite's size is not written down here**, and that is the second
correction to this paragraph rather than the first: it read *"324 files in 96 s, against 316 files
in 252 s"* while the tree ran **431 files and 5371 tests** — a number that grows with every merge
request and was stale by a third. `pnpm --filter backend run test:unit:fast` prints it, and the
printed figure is the only one that is ever current. It skips the 16 unit files that genuinely talk to a live Postgres or Redis —
each named with a reason in `backend/test/service-dependent-unit-tests.ts`, each still run by the
complete suite, and `test/unit/harness/service-dependent-ledger.test.ts` fails if that list drifts
in either direction. Choosing that config **is** the run's declaration that it has no services
(`BACKEND_TEST_SERVICES=none`); the declaration is never inferred from a connection that failed,
and a test that needs a service stops the run with a sentence naming the ledger. The remaining
`test:unit` / `test:contract` / `test:integration` scripts, and `test` itself, are the complete
side and need the services; `test:backend` in CI shards them five ways and takes hours rather
than the better part of one, because since issue #199 the five shards also **serialise**
(`resource_group: backend-suite`). That is not a performance oversight: the runner host is
shared — two GitLab registrations are two job slots on one 4 vCPU / 7.9 GB machine, and that
machine also carries another project's Magento test server — so two shards at once make the
**host's** OOM killer take whichever fork is largest, and a silent `Worker exited unexpectedly`
leaves two hundred files unrun. One whole job costs **2.5 GB** of anonymous memory (2396 MB of
job container plus 202 MB of postgres, redis and meilisearch), flat from its fortieth file to
its last, so the serialisation is a fact about *this* host and should be reconsidered — from the
runner's own `concurrent` setting, not from here — once the suite has a machine to itself. The
numbers and the rejected alternatives, a lower `--max-old-space-size` among them, are in the
Memory block above the job in `.gitlab-ci.yml`. A run that dies that way now says so in the
kernel's own words: `test/oom-evidence.ts` reads the container's cgroup `memory.events` and
`test/run-completeness.ts` prints the verdict beside the files that never ran.

**That cost is what bought D-198**, whose consequence `AGENTS.md` § *The traps that make a
green result meaningless* carries: a five-shard serialised suite on a shared runner, at fifteen
merges a day, is what the merge-request rung was paying for. D-198's own comment block states
the trade in place and calls itself a suspension rather than a design — *"An integration or
contract regression is now found on `master`, after the merge, by whoever runs next."* The
condition for restoring the clause is written beside it.

**Two runs at once no longer corrupt each other** (issue #189). Isolation used to be per
database and per Redis instance, never per invocation: `setupBackendServer` truncates
`SEEDED_TABLES` and reseeds on every booting file, so a second `vitest run` landed its truncate
inside the first one's setup — a `beforeAll` timeout, a teardown dereferencing a handle that was
never built, a just-created row reading back `null`. Every one of those is indistinguishable
from a real failure, which is the actual cost. `test/global-setup.ts` now gives each invocation
its **own** database — `<base>_r_<stamp>_<rand>`, a `create database … template` clone of the
migrated `<base>_tpl`, ~1 s — and its **own** Redis logical database, leased in index 0. Both
are released when the run ends and swept if it crashed. Nothing to remember and nothing to
pass: `TEST_DATABASE_URL` still names the base, and the run's actual DSN is in `DATABASE_URL`
— read that one if you spawn a CLI from a test. `BACKEND_TEST_ISOLATION=shared` restores the
old behaviour for a post-mortem, `BACKEND_TEST_KEEP_DATABASE=1` keeps the run's database, and
`test:unit:fast` is untouched because it declares `BACKEND_TEST_SERVICES=none` and provisions
nothing. See `backend/test/README.md` § *One database per invocation*.

**Per-invocation isolation is not per-file isolation**, and before you move `setupBackendServer`'s
`update "settings" set "global_value" = null`, or replace it with a per-file restore, read the
comment on that statement in `backend/test/helpers/test-server.ts`: a leaked setting can make a
later file *skip* work and pass.

## Proving a cross-file leak: the ordered pair, and the three ways it lies to you

**The instrument.** A file that fails only because an earlier file left state behind passes when
run alone — that is the definition, and it is why a targeted run is no evidence either way. What
separates a leak from a flake is **determinism**: run the leaker, then the victim, and a leak
reproduces every time while a loaded box does not. So the unit of proof is an **ordered pair**,
red before the repair and green after, and every entry in a failure list is then either
*reproduced as an ordered pair* or *unattributed* — never folded into a neighbouring cause to make
a count come out.

**How to order the pair, which depends on the channel the state travels through.**

- **Database state** — `TEST_DATABASE_URL=…/<yours>_test` plus
  `BACKEND_TEST_ISOLATION=shared`, then **two invocations**: leaker first, victim second. Shared
  is what this switch is for. Point it at your own base rather than `b2b_test` so a concurrent
  run in another worktree cannot contaminate the verdict.
- **In-process state** (`process.env`, a module-level singleton) — must be **one** invocation,
  because two invocations are two processes. Order therefore comes from vitest's sequencer, see
  below.
- **Raised timeouts on diagnostics only**: `--hookTimeout=180000 --testTimeout=180000` on the
  command line, never committed. A pair's verdict is about **state**, not timing, so removing a
  load-sensitive failure mode cannot change what is being measured — and without it a
  `beforeAll` that composes a backend dies with `Hook timed out in 30000ms` on a busy machine.
  Quarantine anything timeout- or connection-shaped rather than counting it, and re-run the pair
  rather than reasoning about it.

**The first way a pair lies: `vitest`'s default sequencer runs the *larger* file first.** Two of
three pairs built this way silently ran **victim before leaker** and passed — `connection.test.ts`
(5850 B) ahead of `identity-mappings.test.ts` (3670 B), `vat-push.test.ts` (4386 B) ahead of
`routing-write.test.ts` (2842 B). A pair in the wrong order is a green that means nothing, which
is the exact failure class the instrument exists to remove, reproduced inside the instrument. In
one invocation, therefore, **the leaker must be the larger file**, and the emitted order must be
read back out of the log rather than assumed.

**The second way: the leaker may not leak.** The first attempt at the `process.env` pair used
`contract/settings/secret-redaction.contract.test.ts` as the leaker and passed — because that file
captures the variable, assigns its own value and then `delete`s it in `afterAll`, leaving nothing
behind for the victim to trip on. A green pair whose leaker cleans up says nothing about the
victim. Confirm the leaker actually leaves the state behind before reading anything into the
result.

**The third way, and the one that survived a merge: the leaker may not represent the population
the repair claims to cover.** So — **choose the leaker from the sub-population the repair claims to
cover, and say in the report which sub-population it is.** A pair is evidence about one file's
behaviour; a repair is a claim about a population; the pair is only evidence for the repair if the
leaker is drawn from the part of that population the repair has to survive.

The instance. Pinning `SETTINGS_SECRET_ENCRYPTION_KEY` was verified with
`contract/infakt/webhook.test.ts` as leaker and went green — and `master` reddened anyway.
`webhook.test.ts` is one of the **112** files that write the variable with the preserving idiom
`process.env[K] = process.env[K] ?? randomBytes(32)…`, which is a self-assignment once the key is
pinned; the repair's claim was about all **151** writers, and it is the **36** that assign
unconditionally — plus the **38** that `delete` in `afterAll` — which break it. The pair was drawn
from the 112 the repair could not fail on. Re-verified with
`integration/prompt_actions/bulk-category-flow.test.ts`, which is one of the 36 and also deletes.

**A count is not a population.** The figure that mattered was never 151 — it was the split, and
the split says **74 of the 151 break a pin**. This is the eighth figure in this programme that was
counted but never decomposed, and the first where the decomposition rather than the total was the
whole answer. When a repair's argument turns on *how* a population writes rather than on *how many*
write, decompose before believing the pair.

**Recorded because the wrong answer is the plausible one.** The protocol above replaced a simpler
one that was proposed, accepted and then refuted by measurement: *"two files in one invocation
share the leased database and the fork, so shared isolation is unnecessary."* Both halves of that
sentence are true, and it is still wrong — it omits ordering, which one invocation does not let
you choose. A convention that states only the right answer teaches less than one that says which
wrong answer looks right.

## Worktrees, package resolution and the guard

`AGENTS.md` § *Commands* carries the operation — one command, and never a symlinked
`node_modules` (issue #255). This is what is behind it.

Every package under `packages/` resolves through its own `exports` map at `./dist`,
built from the checkout it lives in — and which checkout that is comes down to one relative
symlink, `backend/node_modules/@endora-commerce/contracts -> ../../../packages/contracts`.
Point a workspace's `node_modules` at another checkout and every one of those links re-roots
there. Measured on this repository, in a worktree whose `packages/contracts` carried a
symbol `master` does not have: `vitest` imported the **main tree's** file and the branch's
own contract test failed against `master`'s source, while `tsc` — protected by the `paths`
block — compiled the worktree's. One run type-checking one branch and executing another is
worse than either being wrong, and `pnpm ls @endora-commerce/contracts` reported this
worktree's path throughout, because it answers from the manifest's `link:` declaration and
never looks at
the symlink. **Do not use it to check this.**

The default is the boring one and it is not slow: `pnpm install --frozen-lockfile` in a
fresh worktree took **4 s** for 2055 packages and cost essentially no disk — every file
under `node_modules/.pnpm` is a hard link into the pnpm store, same inode as the main
tree's. `--link` exists for the worktree that is on a *different* filesystem from the store
(a tmpfs scratchpad, a container mount), where pnpm cannot hard-link and an install
materialises 1.3 GB: it symlinks the **root** `node_modules` — third-party packages only,
identical on every branch — and `cp -a`s each workspace's own, so the relative `@endora-commerce/*`
links inside them re-root here. 0.2 s, and it refuses when `pnpm-lock.yaml` differs from
the checkout it would borrow from.

Getting it wrong no longer produces a wrong measurement: `vitest.config.base.ts` — the one
file every workspace's vitest config merges — refuses the run, naming each foreign link and
its target. **Which runs it covers is derived, not listed.** The guard classifies every
declared consumer→package link in the checkout, whichever workspace invoked it — the count
is in the line it prints — but it is evaluated only where `vitest.config.base.ts` is
**imported**, so coverage is exactly the workspaces whose vitest configuration merges it, and
a run declares its own membership by printing
`[workspace-resolution] read: links=… sources=workspace-packages:…`. A test run that prints
no such line is outside the guard, whatever its colour. This sentence read *“it covers
`backend`, `admin` and `storefront` in one place”* until 2026-08-28: true when written, still
true the day it was replaced, and exactly why nobody learned that five packages under
`packages/` ran on vitest's defaults with no configuration at all. So the derivation is
enforced rather than restated — `backend/test/unit/harness/workspace-resolution.test.ts`
fails a workspace member that invokes vitest with no configuration, and a configuration that
does not import the base. `tsc` is covered
instead by `paths` in `tsconfig.base.json` being complete, which
`backend/test/unit/harness/workspace-resolution.test.ts` keeps true for every package the
workspace globs produce — **however deep** they nest it (feature 080, T040a) — with the
packages the running platform **composes** refused an entry rather than required one. Those
packages keep their sources in their own directories like the other five, so the derivation
alone would demand a `paths` entry; they must not have one, because `paths` is honoured by
`tsc` and `tsx` and not by `vitest` or `node`, so an entry would make the application resolve
their *source* under `tsx` and their *`dist`* everywhere else. For schemas and React components
that split costs nothing; for `HttpError`, `SalesChannel` and `effectiveState` it is the
duplication the platform relocation removed, and
`test/unit/kernel/platform-single-copy.test.ts` is what measures it. For a **module** package
it is worse than a duplication: `paths` would point every `tsx` entry point at eleven decorated
entity files that D-164 measured dying on load, which is the reason that package ships `dist`
at all. Which members those are comes off their own `endora` block — `type: 'platform'` for the
host, `type: 'module'` for a module package — so the exception is derived rather than listed,
and the next module package changes the answer by existing. Both halves of
that population used to be written down: `readdir('packages')`, one level, filtered by the
literal scope `'@b2b/'` — the one the packages carried before T042e renamed them. Neither
survives a module tree a directory deeper under a second scope, and a package this guard
cannot see is a package with no protection at all — which is the one way a #255 repair can
regress in silence. `ALLOW_FOREIGN_WORKSPACE_PACKAGES=1` is the override for deliberately
measuring another checkout. What neither covers is `eslint` and the `check-*` scripts —
stated here rather than discovered later. See `scripts/workspace-resolution.ts`.
