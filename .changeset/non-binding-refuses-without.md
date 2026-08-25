---
'@endora-commerce/contracts': minor
---

`ModuleNonBindingDependencySchema.kind` gains a third member,
`'refuses-without'` — a module declaring that a cross-module read has no
fallback, without binding the owner's lifecycle.

The two existing kinds cover "an inert push" (`contributes-to`) and "I keep
working with less" (`degrades-without`). There was no spelling for "this
operation stops", and the two arrays that carried that meaning —
`dependencies` and `acknowledgedDependencies` — both bind: an operator may not
switch the owner off while the dependent is present. A dependent that is itself
`activation.nonDeactivatable` therefore turned the *owner's* activation control
into a control that does nothing when flipped.

```ts
nonBindingDependencies: [
  {
    moduleId: 'payments',
    name: 'orderPlacementPaymentApplyPort',
    kind: 'refuses-without',
    whenAbsent: 'checkout cannot take an order, because no payment method is available',
    reason: 'The placement seam has no fallback; binding would leave payments.enabled inert.',
  },
]
```

`whenAbsent` is **required** for the new kind and `defineModuleManifest` throws
without it: the deactivation-consequence ledger classifies such an edge
`fails-closed`, which is what an undeclared gated port already classifies as, so
the sentence is the whole of what the declaration adds. It is what the operator's
confirmation dialog renders in place of a translated default.

Additive: `'contributes-to'` and `'degrades-without'` are unchanged, no existing
field changed shape, and `defineModuleManifest` refuses nothing today that it
accepted before. Consumers exhausting `ModuleNonBindingDependency['kind']` in a
`switch` or a mapped type gain a case; a `Record<kind, …>` over it stops
type-checking until the third key is added.
