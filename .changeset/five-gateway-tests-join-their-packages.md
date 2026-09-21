---
---

Feature 134 W2 for the five payment gateways: nine of `stripe`'s, `tpay`'s, `payu`'s,
`autopay`'s and `paypal`'s single-owner tests move from `backend/test/unit/` and
`admin/test/modules/` into their own packages, beside their subjects. No package's published
output changes in a way a consumer can call, so this carries no release meaning.

Asked as `specs/conventions/release-intent.md` asks it — *"does this commit change what a
published package emits?"*, a function of the package's `tsconfig.build.json` rather than of
a path — and asked separately for each of the three mechanisms a file this branch adds could
reach a tarball through.

**The backend `.ts` half, by configuration.** All five of `@endora-commerce/mod-stripe`,
`mod-tpay`, `mod-payu`, `mod-autopay` and `mod-paypal` have a `tsconfig.build.json` with no
`exclude` of its own that `extends` the package's `tsconfig.json`, whose `exclude` is
`["src/admin/**/*", "src/**/*.test.ts", "src/**/*.spec.ts"]`. Every file moved into a
package here is a `src/**/*.test.ts`, so all of them are outside the emit by name — which is
also why the pattern is there at all: that `exclude`'s own comment says a compiled test would
import `vitest`, a devDependency, and be an unresolvable specifier in every consumer's
install.

**The admin `.test.ts` half, which the first answer does not cover**, because `src/admin/` is
compiled by `tsconfig.ui.json` and by nothing else. That configuration replaces the inherited
`exclude` rather than adding to it, and its replacement is
`["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.spec.ts", "src/**/*.spec.tsx"]` — so
`src/admin/index.test.ts` is outside that emit too, in all five. Verified rather than
reasoned: `pnpm run build:packages` after the move leaves no `*test*` path under any of the
five `dist` trees.

**The asset half, which `tsconfig` says nothing about — and this branch has none.** No
fixture, vector or `.json` accompanies any moved file; the i18n parity tests read the
package's existing `i18n/en.json` and `pl.json`, which the `files` array already publishes and
which are unchanged.

**One emitted byte does change, and it is a comment.** Each of the five
`src/admin/index.ts` files carried a pointer to
`admin/test/modules/<id>.module-owned-surface.test.tsx`, a path that has not existed since
feature 091 merged the five into one file; it now points at the disposition and at the
module's own `index.test.ts`. `tsc` preserves JSDoc, so `dist/admin/index.d.ts` differs. No
exported symbol, signature, subpath or runtime behaviour does, which is the case
`specs/conventions/release-intent.md` names in terms — *"a comment, a test, a rename crossing
no export"* — and asks for the empty changeset rather than a bump.

`tpay`, `payu` and `paypal` also gain a `vitest.config.ts` and, from
`manifests:generate`, a `test` script and a `vitest` devDependency. `files` publishes `dist`,
`i18n`, `docs` and `tailwind.css`, so the configuration is not in the tarball; the manifest's
`devDependencies` are, and they are not resolved by a consumer's install.
