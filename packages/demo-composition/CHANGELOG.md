# @endora-commerce/demo-composition

## 0.103.1

### Patch Changes

- Updated dependencies [7f6a4ba]
  - @endora-commerce/mod-inventory@0.103.1
  - @endora-commerce/mod-admin-roles@0.103.1
  - @endora-commerce/mod-admin-users@0.103.1
  - @endora-commerce/mod-catalog@0.103.1
  - @endora-commerce/mod-credit-limits@0.103.1
  - @endora-commerce/mod-custom-fields@0.103.1
  - @endora-commerce/mod-customer-accounts@0.103.1
  - @endora-commerce/mod-megamenu@0.103.1
  - @endora-commerce/mod-organizations@0.103.1
  - @endora-commerce/mod-price-lists@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- 7f579d2: **A demo seed or reset that stops part-way no longer leaves the demo administrators without a
  role.** An administrator without a role is refused, and a demo run is not one transaction, so the
  pairing of the three demo accounts with their roles can no longer wait for a late step:
  - `demo seed` creates each demo administrator already holding its role. An account that an
    earlier, interrupted run left without a role is given it on the next `demo seed`; a role
    somebody chose for one of these accounts is never replaced.
  - The composition step "demo administrators take their roles" now runs first and only fills in a
    missing role. Its withdrawal no longer unassigns anything.
  - `demo reset` deletes the demo accounts with their role still on them, then the demo's own
    `sales_representative` role. The `platform_admin` role stays.

  `demo seed` now fails, naming the role, if a role a demo administrator needs does not exist,
  rather than creating the account without one.

  **Several processes can start at once on a database that does not hold the
  platform-administrator role yet.** Each process ensures the role at boot; the ones that lose the
  race now find the role the winner created instead of failing to start.

- Updated dependencies [08192f0]
- Updated dependencies [a609ce3]
- Updated dependencies [7f579d2]
- Updated dependencies [f052b7f]
- Updated dependencies [9eb7ed9]
- Updated dependencies [9eb7ed9]
- Updated dependencies [f2a2dca]
- Updated dependencies [11c0962]
  - @endora-commerce/mod-admin-roles@0.103.0
  - @endora-commerce/mod-admin-users@0.103.0
  - @endora-commerce/mod-organizations@0.103.0
  - @endora-commerce/mod-catalog@0.103.0
  - @endora-commerce/platform@0.103.0
  - @endora-commerce/mod-credit-limits@0.103.0
  - @endora-commerce/mod-inventory@0.103.0
  - @endora-commerce/mod-custom-fields@0.103.0
  - @endora-commerce/mod-customer-accounts@0.103.0
  - @endora-commerce/mod-megamenu@0.103.0
  - @endora-commerce/mod-price-lists@0.103.0

## 0.102.0

### Patch Changes

- Updated dependencies [3f7f481]
- Updated dependencies [489a0b6]
- Updated dependencies [489a0b6]
- Updated dependencies [489a0b6]
- Updated dependencies [489a0b6]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/mod-inventory@0.102.0
  - @endora-commerce/mod-catalog@0.102.0
  - @endora-commerce/mod-megamenu@0.102.0
  - @endora-commerce/mod-organizations@0.102.0
  - @endora-commerce/mod-price-lists@0.102.0
  - @endora-commerce/mod-admin-roles@0.102.0
  - @endora-commerce/mod-admin-users@0.102.0
  - @endora-commerce/mod-credit-limits@0.102.0
  - @endora-commerce/mod-custom-fields@0.102.0
  - @endora-commerce/mod-customer-accounts@0.102.0

## 0.101.1

### Patch Changes

- Updated dependencies [69a3717]
  - @endora-commerce/mod-admin-users@0.101.1
  - @endora-commerce/mod-catalog@0.101.1
  - @endora-commerce/mod-credit-limits@0.101.1
  - @endora-commerce/mod-customer-accounts@0.101.1
  - @endora-commerce/mod-custom-fields@0.101.1
  - @endora-commerce/mod-inventory@0.101.1
  - @endora-commerce/mod-megamenu@0.101.1
  - @endora-commerce/mod-organizations@0.101.1
  - @endora-commerce/mod-price-lists@0.101.1
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/mod-admin-roles@0.101.1

## 0.101.0

### Patch Changes

- Updated dependencies [be758bb]
- Updated dependencies [89b0de3]
- Updated dependencies [667e9e1]
- Updated dependencies [5749604]
- Updated dependencies [be758bb]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d919418]
  - @endora-commerce/mod-admin-users@0.101.0
  - @endora-commerce/platform@0.101.0
  - @endora-commerce/mod-catalog@0.101.0
  - @endora-commerce/mod-admin-roles@0.101.0
  - @endora-commerce/mod-credit-limits@0.101.0
  - @endora-commerce/mod-custom-fields@0.101.0
  - @endora-commerce/mod-customer-accounts@0.101.0
  - @endora-commerce/mod-inventory@0.101.0
  - @endora-commerce/mod-megamenu@0.101.0
  - @endora-commerce/mod-organizations@0.101.0
  - @endora-commerce/mod-price-lists@0.101.0

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
