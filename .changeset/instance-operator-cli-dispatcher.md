---
'@endora-commerce/platform': minor
'@endora-commerce/cli': minor
---

A scaffolded instance runs the operator commands its modules declare, and can create the
administrator that logs in to it (`specs/123-oss-install-experience/` G2).

**The defect.** `endora new instance` reported `backend/src/cli.ts` as an omission, on the written
reason *"the demo layer around it is exported under no subpath"*. A client's instance therefore had
**no module-declared CLI command at all** — no `admin_users create`, no `search reindex`, no
`_i18n reload` — so the admin bundle acceptance assertions A5 and A13 prove is built and styled had
nobody to log in as. Half of that reason had already been discharged: `./demo` has been a declared
subpath since `specs/110-instance-repository/` T119b. What was still unpublished was
`backend/src/cli/demo-command.ts`, which `test/unit/kernel/host-residue-partition.test.ts` had
ledgered as platform-shaped residue with a `retiredBy` naming exactly this move.

**`@endora-commerce/platform`** gains the dispatch on the subpath that already carried half of it.
`./cli` adds `runCli`, `dispatchCli`, `cliFailureExitCode` and `CLI_USAGE`; `./demo` adds
`DEMO_HOST_COMMANDS`, `demoEntriesFrom`, `isDemoInvocation`, `parseDemoVerb`, `demoHelpFor`,
`formatHostCommandList`, `ShadowedHostCommandError`, `NO_DEMO_COMPOSITION_NOTICE` and the
`DemoCompositionLoader` shape. **No subpath is added and `PUBLISHED_SUBPATHS` stays at five** — both
are host-internal under D-160.14, a module naming either is still `host-internal-subpath`, and
`check:platform-surface` is green with no ledger key moved.

What did **not** move is what names a path in the tree that installs the platform, which is
`operator-half.md` §1.1's whole partition: a build's generated core index, its own `composeApp`, its
demo-composition probe and the one directory holding `apps/`. All four are parameters of `runCli`
with defaults an instance can take, so this repository's `backend/src/cli.ts` supplies four of them
and a scaffolded instance's supplies one and is five lines.

**`@endora-commerce/cli`** writes `backend/src/cli.ts` — six lines, `kind: 'wiring'` — and the
`omitted.push` block is deleted rather than reworded, because an omission whose reason has been
discharged must not survive as prose. The instance's manifests gain `cli` (the generic pass-through:
any installed module's declared command is addressable with no file in the tree edited) and, derived
from the resolved module set rather than written, `admin:create` when `admin_users` is installed.
`nextSteps()` gains the administrator step after `module:install --all` and the demo step its own
docstring has claimed was there since D-216.

**No `demo:seed` or `demo:reset` script is written**, and G2's T2-D asked for both. D-216 is the
owner's and is more specific than the task: *"a client scaffolding an instance for their own trading
receives no demo artefact in a tree they own: no composition, **no script**, no example and no
placeholder"* — and it names where the capability does belong, which is the next-steps block.
`pnpm run cli demo seed` reaches both verbs, so nothing is unavailable.

Wiring cost, re-measured on the plan rather than computed from a delta: **237** lines over 12 files
without the admin member and **248** with it, against R1.4's bound of 250.
