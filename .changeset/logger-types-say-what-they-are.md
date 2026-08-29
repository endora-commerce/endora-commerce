---
'@endora-commerce/platform': major
'@endora-commerce/contracts': patch
---

**`WorkerLogger` is gone; the type is `PlatformLogger`.** One structured-logger shape had
three exported names, and two of them were the same word.

`@endora-commerce/platform/kernel` no longer exports `WorkerLogger`. The identical interface —
`info(obj, msg)` / `warn(obj, msg)` / `error(obj, msg)` — is exported as `PlatformLogger`,
from the file that documents and produces it. It is the type of `ModuleContext.log`, of
`DefineModuleWorkerOptions.logger`, and of every `log` a module is handed or holds.

```ts
// before
import type { WorkerLogger } from '@endora-commerce/platform/kernel';
class RefundHandler { constructor(private readonly log: WorkerLogger) {} }

// after
import type { PlatformLogger } from '@endora-commerce/platform/kernel';
class RefundHandler { constructor(private readonly log: PlatformLogger) {} }
```

The rename is the whole migration: the shape is byte-identical, so nothing but the imported
name changes. A `type WorkerLogger = PlatformLogger` shim in your own code compiles, but it
re-creates the second name this release exists to remove.

Also removed: `ModuleLifecycleLogger` from `kernel/module-context.ts`, an alias of the same
interface that no barrel published — a module could not name it, only meet it by hovering
`ctx.log`. Nothing importable is lost.

**Why it was a defect and not untidiness.** `@endora-commerce/contracts` exports a
`ModuleLifecycleLogger` of its own, and it is a *different* shape: the install/uninstall hook
logger, `info(msg: string)`, one argument. The platform's alias claimed the same name for the
two-argument shape. An author who read the published contracts package — the package whose job
is to be the published shape — and wrote `ctx.log.info('…')` got `TS2554: Expected 2
arguments, but got 1`, with two names resolving and both of them ours.

`@endora-commerce/contracts` keeps `ModuleLifecycleLogger` unchanged. Its name was the accurate
one: it is the logger of `ModuleLifecycleContext` and of the two lifecycle-participant events,
all called by the orchestrator, which tags the module id so the hook author writes plain
messages. Its doc block now says what it is not.
