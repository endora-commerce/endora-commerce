---
'@endora-commerce/platform': minor
---

**`@endora-commerce/platform/lifecycle` gains the five `module:*` command bodies and the seam they take** (D115-1; `specs/115-lifecycle-container-move/contracts/operator-half.md` §2).

New on the `./lifecycle` barrel: `runInstallCommand`, `runUninstallCommand`, `runEnableCommand`, `runDisableCommand`, `runStatusCommand` — each `(argv, rt) => Promise<number>` — and the `OperatorRuntime` interface they take. Together they are the whole of what an operator's terminal does to a platform: the argv grammar, the exit-code table of `specs/018-module-lifecycle/contracts/cli-commands.md` §C-1, the orchestrator wiring, `mapError`, and every sentence a `module:install`, `module:uninstall`, `module:enable`, `module:disable` or `module:status` prints. All 827 lines of it used to sit in `backend/src`, which under D-207 a client instance never receives, so an instance that installed the platform got the orchestrator and none of the ways to drive it.

**`OperatorRuntime` carries no container, and that is the design rather than an omission.** It is an ORM handle, an `EntityManager` factory, a Redis connection, the instance-resolved manifest entries, an optional migration-ownership reader and two output functions. A command that cannot reach a composition cannot run one, so D-157.2/.4's failure — composition's own reconciler marking every shipped module `installed`, whereupon `module:install X` returns `already-installed` at exit 0 having applied no migration and run no install hook — is structurally unreachable rather than remembered.

**The entries are a value, not a thunk** (R2.2): resolving them reads `node_modules` and may raise the module-id collision refusal, so whoever builds the runtime resolves them first and maps that refusal to its own exit code. Output goes through `out` and `err` and never `process.stdout` (R2.4), which is what lets an instance frame it and what makes a body testable without a process.

**Nothing became public API and nothing is removed.** `PUBLISHED_SUBPATHS` stays at five; `./lifecycle` remains host-internal, so a module naming any of these symbols is still a `host-internal-subpath` finding. In this repository the five entry points at `backend/src/lifecycle/scripts/*.ts` keep their paths and their `backend/package.json` script names, and are now the ORM handle, the Redis connection and the system scope — about twenty lines each, which is what an instance writes against its own configuration.
