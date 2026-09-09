---
'@endora-commerce/platform': minor
---

The demo runner now resolves `demo.package`, the escape hatch a module takes when its demo data
would be too heavy to ship in the module itself.

Declaring the field used to record an intent and change nothing. It now answers three ways, and
the second and third are deliberately not the same answer:

| | |
| --- | --- |
| resolvable, loads | the module's demo data is the package's |
| **not resolvable** | reported by name as *not installed*; the module contributes nothing; the run continues |
| resolvable, **fails to load** | a failure, reported as one, naming the module |

The probe happens **before** the import and by a different mechanism — `require.resolve`, which
answers without evaluating — so a demo package that is installed and broken cannot be reported as
an absent one. A single `try { await import(name) } catch { … }` around both would collapse those
two rows into one and continue quietly on a package that is there and does not work.

**A demo package exports `demo`**: an object with a `summary` string and `seed` and `reset`
functions. When it loads it replaces the module's declared `summary`, `seed` and `reset` — it has
to, because the module's own sources may not name the package, so a declared body could not reach
the data. `after` is not read from the package: ordering is decided from the declarations before
anything is loaded. A package that loads and carries no such export is a `DemoPackageShapeError`
naming the field to fix, rather than a `TypeError` from the first call.

New exports: `createDemoPackageResolver`, `demoBodyFromPackage`, `DemoPackageShapeError`,
`DemoPackageResolver`, `DemoPackageSkip`, `DemoRunSkip`.

`RunDemoInput` gains an optional `demoPackages`. It defaults to Node's own resolution from
`process.cwd()`, which for `endora demo seed` is the instance root — never the platform's own
`node_modules`, where a client's demo package is not and must not be. Pass your own if you run
from somewhere else.

`DemoRunResult.skipped` widens from `DemoPlanSkip[]` to `DemoRunSkip[]`, which adds one member
carrying `reason: 'demo-package-not-installed'` and the package's name. `formatDemoReport` prints
the two reasons apart, because they ask an operator for different things: switch a module on, or
install a package.
