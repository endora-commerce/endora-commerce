---
'@endora-commerce/cli': patch
'@endora-commerce/platform': patch
---

An overlay module that ships schema is now refused by `migrate` as well, and every entry point prints the refusal as a sentence. `migrate` composes nothing, so over a tree with a `migrations/` directory under `apps/<deployment>/modules/` it applied every package's schema, none of that directory's, and exited 0; the API and the worker refused it, as an uncaught exception with a stack trace. `@endora-commerce/platform/composition` now exports `refuseOverlaySchema(deploymentRoot)`, which prints the refusal and exits 1, and `exitOnRefusal`, for `.catch()` on `composeApp`: it prints an `OverlaySchemaError`'s message and exits 1, and rethrows anything else untouched. `endora new instance` writes both into `backend/src/migrate.ts`, `index.ts` and `worker.ts`, and the operator CLI (`runCli`) prints the same refusal without a stack. An instance written by an earlier release gets the clean message and the `migrate` check by adding those three lines by hand; without them it behaves as before.
