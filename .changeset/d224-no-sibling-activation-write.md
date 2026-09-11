---
---

No release meaning, and the empty changeset is the point rather than a way past the gate.

This merge request reverts `cascadeDependentsOnDeactivate` — the optional field on
`ModuleActivationSchema`'s switchable arm, its `ModuleActivationDeclaration` twin, the write
in `makeSetActivationCommand` and the propagation in the activation route — under the owner's
ruling **D-224**, *"a module's deactivation may refuse, and may not write a sibling's
activation"*. `invoice_ledger` returns to `activation.nonDeactivatable`.

Nothing here reaches a consumer. The field was added on `feat/119-infakt-integration` after
`0.7.0` and is in no published version of `@endora-commerce/contracts`, of
`@endora-commerce/platform` or of `@endora-commerce/mod-invoice-ledger`; the changeset that
would have released it (`.changeset/invoice-ledger-switchable.md`) is deleted in the same
merge request, which is what puts the registry's view back where it already was. A changeset
describing the removal would announce to an upgrader a field they never had.
