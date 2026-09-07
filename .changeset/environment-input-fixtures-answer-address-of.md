---
---

`@endora-commerce/contracts` — a test-file change only, and it carries no release
meaning: nothing under `test/` is in `tsconfig.build.json`'s `include`, so no
byte of it reaches a consumer's install.

`environment-inputs.unit.test.ts`' fixtures now answer `addressOf`, which
`environment-input-address-of.md` made a required member of `EnvironmentInput`
for the stated reason that an optional field is forgotten once, by whoever adds
the next address. Zod then refuses a declaration without it, and four fixtures
in that file were construction sites the change did not reach. The field is
untouched; the fixtures are the repair.
