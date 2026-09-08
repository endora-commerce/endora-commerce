---
'@endora-commerce/platform': minor
'@endora-commerce/cli': patch
---

`./cli` — the host's side of a module-declared operator command.

Everything a `<module id> <command name>` invocation decides with no process and no
database is the platform's now (`specs/110-instance-repository/` T117, FR-013): the
enumeration of every command the resolved manifest set declares, the two refusals a
declaration can earn, the lookup, the `--list` and `--help` renderings, and the
find-gate-invoke that decides presence from the module that **declared** the command,
first and outside every `try`. A client's copy of that is a copy that diverges the first
time we correct ours.

**`./cli` is a new host-internal subpath.** Declared by the `exports` map and carried by
no published barrel (D-160.14), so `node` and `tsc` resolve it for a host and a
composition root while a module reaching it is answered `host-internal-subpath` by
`check:platform-surface`. The reason is `./composition`'s own, one surface over: this is
the code that decides which command runs and whether the module that declared it is
present at all, so a module that could name it could enumerate its siblings' operator
commands and invoke one. A module declares its commands in its own `manifest.ts` and
receives a `ModuleContext`; that is the whole of the surface it is entitled to.

```ts
import {
  collectModuleCommands,
  findModuleCommand,
  formatCommandList,
  helpFor,
  runModuleCommand,
  InvalidCommandDeclarationError,
  UnknownCommandError,
  type CommandDeclaringEntry,
  type DeclaredCommand,
  type RunModuleCommandOptions,
} from '@endora-commerce/platform/cli';
```

**Nothing is removed and no signature changes.** `runModuleCommand` still takes the
resolved manifest entries and the composition's own `contextFor`, so a host that already
holds a `ComposeAppHandle` passes exactly what it passed before. What a host still writes
itself is the **process**: reading `process.argv`, composing, opening one system scope over
the composed container, disposing it, and turning the answer into an exit code. That is
this repository's `backend/src/cli.ts` and an instance's own, because every one of those
is a fact about a deployment's entry point rather than about the platform.

**It is not the `module:*` path and must not become one.** Those five operate *on* the
platform, compose nothing (D-157.2/.4), and keep their own entry points over
`@endora-commerce/platform/lifecycle`'s `commands/<verb>.ts`.

`@endora-commerce/cli` takes a patch: `HOST_INTERNAL_SUBPATHS` gains `cli` with the reason
it is not public API, which is what makes the estate's checks and
`published-surface.test.ts` answer for the new subpath in both directions.
