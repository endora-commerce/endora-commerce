---
---

Feature 134 W2 for `infakt`'s last extraction blocker: the invoice-ledger section strip's admin
test is dispositioned by subject, so each of the two modules that declare a tab on it carries
its own declaration and its own screen's hygiene in its own package, and the host keeps the zone
mechanism over a synthetic vendor contribution. No package's published output changes in a way a
consumer can call, so this carries no release meaning.

Asked as `specs/conventions/release-intent.md` asks it — *"does this commit change what a
published package emits?"*, a function of the package's `tsconfig.build.json` rather than of a
path — and asked separately for each of the mechanisms a file this branch touches could reach a
tarball through.

**The admin `.test.ts` half, which is the only new file here.**
`packages/modules/infakt/src/admin/index.test.ts` sits under `src/admin/`, which is compiled by
`tsconfig.ui.json` and by nothing else: the package's `tsconfig.json` excludes
`src/admin/**/*`, and `tsconfig.build.json` inherits that exclusion. `tsconfig.ui.json`
**replaces** the inherited `exclude` rather than adding to it, and its replacement names
`src/**/*.test.ts` — so the file is outside that emit as well. Verified rather than reasoned:
after `pnpm run build:packages`, `packages/modules/infakt/dist/admin/` holds
`index.{js,d.ts}` and the three source directories, and no `*test*` path anywhere.
`@endora-commerce/mod-invoice-ledger` is the same configuration and its own
`src/admin/index.test.ts` has never been emitted.

**The asset half, which `tsconfig` says nothing about — and this branch has none.** No fixture,
no vector, no `.json`. Both package tests read the package's own `.tsx` screens with
`readFileSync` at test time; nothing is added to any `files` array.

**One emitted byte does change, and it is a comment.**
`packages/contracts/src/admin-contributions.ts`' `ledger.section.tabs` doc block named a paid
vendor by id and pointed the per-screen mount assertion at a single file under `admin/test`.
It now names no vendor — a free package's source naming a module wave 4 removes is the reach
that sweep exists to remove — and points at the per-package assertion that replaces it. `tsc`
preserves JSDoc, so `@endora-commerce/contracts`' `dist/admin-contributions.d.ts` differs. No
exported symbol, signature, subpath or runtime behaviour does: `AdminZoneNameSchema` still
carries `ledger.section.tabs` and `LedgerSectionTabsZoneProps` is untouched. That is the case
`specs/conventions/release-intent.md` names in terms — *"a comment, a test, a rename crossing no
export"* — and asks for the empty changeset rather than a bump.

Neither module gains a `vitest.config.ts` or a `test` script: both already had them, so no
manifest is re-rendered and the lockfile does not move.
