---
'@endora-commerce/platform': minor
---

A contribution to a registry that was never registered is dropped.

A module resolving a container name that **its own manifest declares as a `contributes-to`
edge** now receives an inert sink when nothing in the composition registers that name,
instead of an `AwilixResolutionError`. Every method on the sink is a no-op returning
`undefined`. New host-internal exports on `kernel/contribution-sinks.ts`:
`provideDeclaredContributions`, `isDeclaredContribution`, `DROPPED_CONTRIBUTION_SINK` and
the `DeclaredContribution` type; `installGatingGraph` and `provideDefaultGatingManifests`
supply the declaration set, so a consumer that already establishes manifests wires nothing.

Why a consumer cares: a module's `dependencies` guarantee the owner is installed, and
`nonBindingDependencies` deliberately withdraws that guarantee — which is the whole reason
`contributes-to` exists, since declaring the dependency would make an optional module
undeactivatable for as long as a non-deactivatable one is present. An instance that installs
a contributor without the owner is therefore a supported state, and until now the eager read
in the contributor's boot hook exited the process before it served a request. A contributor
needs no change and learns nothing: it pushes without knowing whether the registry is here.

It is deliberately narrow, and the narrowness is the whole safety argument. The drop is not
"an unregistered name resolves to something" — that would turn every typo and every missing
dependency into a silent `undefined`. It fires only when the reading module's own manifest
declares that exact name as `contributes-to`, nothing in the composition registers it, and a
manifest set has been supplied at all. A process that established no manifests keeps the
previous behaviour.

The bound, stated rather than discovered: this covers `contributes-to` and not
`degrades-without`. A contribution is a push, so nothing observes the result and dropping it
is the declared outcome. A `degrades-without` read is a pull whose declaration promises a
*degrade* — a different branch, not a silent no-op — and answering `undefined` from a
registry's `get` is indistinguishable from "no entry for this code", which is a fail-open.
