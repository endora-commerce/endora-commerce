---
---

No release meaning. Five packages under `packages/` gain a `vitest.config.ts` that merges the
repository root's `vitest.config.base.ts`, which is where issue #255's foreign-workspace-link
refusal lives — `contracts`, `api-client`, `cms-components` and `email-components` had no
vitest configuration at all and ran on vitest's defaults, and `page-builder-core` had one that
did not merge the base. All five now refuse a run whose `@endora-commerce/*` links resolve
into another checkout, and each prints the guard's own `[workspace-resolution] read:` line.

Nothing a consumer resolves moves. The configuration file is in no package's `files` and in no
`tsconfig.build.json` emit, so no `dist` byte changes; `include` is left at vitest's default in
the four that had none, so each collects exactly the files it collected before. The four `test`
scripts that read `vitest run --passWithNoTests` now read `vitest run`: three of them ship test
files, where the flag could only ever hide a run that stopped collecting them, and
`@endora-commerce/api-client` — which ships none — keeps the behaviour as
`test.passWithNoTests` in its own configuration, beside the paragraph saying why it is there
and when to delete it.
