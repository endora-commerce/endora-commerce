---
---

`@endora-commerce/platform` gains no behaviour here — one doc block on
`committedModuleDependencies` changes, and nothing else in the package moves.

The sentence that changed claimed the derivation had exactly one caller, and that a
second caller would be a second ordering graph. It was false when it was written:
the host binds the function a second time so its own tests can drive it over the
generated manifest index, and a second **caller** is neither necessary nor
sufficient for a second **graph**. What refuses a second graph is the contract
guard in the application's tree, which counts calls of `orderMigrations` and
follows the input of the one call there may be.

No exported symbol, signature or value is affected, so there is nothing for a
consumer of this package to do.
