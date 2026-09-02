---
'@endora-commerce/mod-customer-accounts': minor
'@endora-commerce/mod-product-feeds': minor
'@endora-commerce/mod-comparisons': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-invoices': minor
'@endora-commerce/mod-payments': minor
'@endora-commerce/mod-orders': minor
---

Declared as `peerDependencies` the packages these seven already publish types from (D-181).

Each of them emits a `.d.ts` that imports a specifier its manifest declared only as a
`devDependency`, which a consumer's install does not resolve. The consequence is silent:
the type becomes `any`, and under `skipLibCheck: true` — what `tsc --init` writes — there
is **no diagnostic at all**. Measured on `@endora-commerce/mod-catalog` with
`@endora-commerce/mod-custom-fields` not installed: the exported
`CatalogCradle.customFieldDefinitionService` typed as `any`, clean compile; with it
installed, the correct `CustomFieldDefinitionApplyApi` and a refused assignment.

Eleven peers, in two shapes:

- **A published port interface of another module package** — `mod-catalog` →
  `mod-custom-fields`, `mod-customer-accounts` → `mod-organizations`, `mod-orders` →
  `mod-carts` / `mod-credit-limits` / `mod-inventory` / `mod-invoices` / `mod-promotions`,
  `mod-payments` → `mod-orders`. All are `import type … from '<pkg>/ports'` and all appear
  in the emitted declarations, so a consumer type-checking the package resolves them.
- **A `@types/*` companion whose library reaches the declarations** — `@types/pdfmake`
  for `mod-invoices` and `mod-comparisons` (`pdfmake/interfaces.js` has no types without
  it), `@types/ssh2-sftp-client` for `mod-product-feeds`.

**If you install one of these packages**, its peers are now install-time requirements
rather than something your own tree happened to provide. `@types/nodemailer` and
`@types/web-push` are deliberately *not* among them: their libraries are imported inside
function bodies and reach no published signature. Neither is `@types/react` or any other
types package that contributes global declarations — those exist once in a program by
construction, and forcing our copy is a conflict you could not fix.

`minor` rather than `major`: nothing here changes an exported symbol or a call, and the
requirement is one a consumer that type-checks these packages already had to satisfy for
the types to mean anything. It is more than a patch because a resolver that was silently
succeeding will now report an unmet peer.
