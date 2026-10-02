# @endora-commerce/demo-composition

## 0.100.2

### Patch Changes

- 54c7417: `demo seed` on an instance scaffolded by the CLI now builds a working demo shop. Before, it created every module's own demo rows and nothing that joins them: `admin@demo.local` and both sales representatives had no admin role (`/admin/me` answered `permissions: []`, so the admin sidebar was empty), and the 203 demo products were sold on no sales channel, so the storefront listed none. The wiring — roles, channel and category bindings, the menu, prices, stock, the demo buyer, attributes, images, attachments and the credit limit — was a file in the platform repository's own host, which no instance had.

  It is now the new package `@endora-commerce/demo-composition`. The platform's operator CLI finds an installed package declaring `"endora": { "type": "demo-composition" }` when the instance's `cli.ts` passes no `demoComposition` loader, and runs it; with none installed, `demo seed` behaves as before and its notice now names the package to add. `endora install --demo` and the new `endora new instance --demo` add the package to the instance's module list and write no file into the tree.

  The demo adopts the instance's system-default sales channel as its retail channel and keeps that channel's code when the operator chose one (`DEFAULT_SALES_CHANNEL_CODE`); only the platform's fallback code, `default`, is renamed `pl_retail`, as before. It used to rename any code, which would have moved the demo off the channel a storefront is built against.

  `@endora-commerce/platform/demo` — the host-internal subpath no module may name — no longer exports `NO_DEMO_COMPOSITION_NOTICE` or the `DemoCompositionLookup` type; their only consumer outside the platform was the loader this change removes. `DemoCompositionInput` stays, as the argument `createDemoComposition` takes.

  To fix an existing instance: `pnpm add -w @endora-commerce/demo-composition` at the instance root (it is a pnpm workspace, so plain `pnpm add` refuses), then `pnpm run cli demo seed` again. The seed is idempotent, so the rows already there are joined rather than duplicated.

- Updated dependencies [54c7417]
- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/mod-admin-roles@0.100.2
  - @endora-commerce/mod-admin-users@0.100.2
  - @endora-commerce/mod-catalog@0.100.2
  - @endora-commerce/mod-credit-limits@0.100.2
  - @endora-commerce/mod-custom-fields@0.100.2
  - @endora-commerce/mod-customer-accounts@0.100.2
  - @endora-commerce/mod-megamenu@0.100.2
  - @endora-commerce/mod-organizations@0.100.2
  - @endora-commerce/mod-price-lists@0.100.2
  - @endora-commerce/mod-inventory@0.100.2
