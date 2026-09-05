---
'@endora-commerce/contracts': minor
'@endora-commerce/platform': minor
'@endora-commerce/cli': minor
---

Added the deployment divergence report's shape, and gave `decorationOrder` a supply.

**`@endora-commerce/contracts`** exports `DivergenceReport`, `DivergenceEntry`,
`DivergenceKind`, `DivergenceDetail`, `DivergenceBoundary` and `DivergenceKey` — the shape of
the committed record of how one deployment's tree differs from core. Nine kinds, one per seam a
deployment can use, each entry naming what was changed, the module that changed it, the module
that owns what was changed, the rung of the customisation ladder it sits on, and the
deployment's own sentence.

Two fields are nullable on purpose and a consumer has to handle both. `entry.rung` is `null`
for `registration`, `worker` and `omission`: the ladder ranks ways of changing what *core* does,
and those three are a module contributing its own surface or a declaration. `detail.depth` is
`null` on every `decoration` in a committed report, because depth is a fact about a composition
rather than about a tree — the runtime half of the report fills it in.

**`@endora-commerce/platform`**: `ComposeModulesOptions.decorationOrder` is read by both of
this repository's composition roots for the first time. Nothing about the field's type or its
semantics changed — it is still *checked, never applied* — but a composition that passes it now
gets the assertion it always described, and `AmbiguousDecorationError`'s message changes with
it: it names the deployment's own declaration file and the field, and suggests the order
composition would apply, instead of telling its reader that there is no way to declare one.

`ForeignDecorationError`, `PackageDecorationNotOfferedError` and `DuplicateRegistrationError`
each gained the rung they refused and the nearest lower rung that works, by mechanism. **If you
assert on any of these four messages, they have moved.** `error.name` and the constructor
arguments are unchanged.

**`@endora-commerce/cli`**: one estate row, `check:divergence`, classified `repository-only` —
a rule's subject there is a deployment, and a module package is not one.
