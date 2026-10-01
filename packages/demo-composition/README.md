# @endora-commerce/demo-composition

The Endora Commerce demo shop's **composition**: the wiring between the modules' own demo data
that no single module may own.

`pnpm run cli demo seed` runs every installed module's demo data first — the catalogue, the
roles, the administrators, the warehouse, the organisation. Each module writes only its own
tables, so nothing in those rows says which sales channel sells the products or which role each
demo administrator holds. This package is what says it:

- the demo's two sales channels, the retail one adopting the instance's system-default channel;
- the demo products bound to their categories and sold on the default channel;
- the demo administrators holding their roles (`admin@demo.local` → `platform_admin`, the two
  sales representatives → `sales_representative`);
- the menu over the category tree, the default price list backfill and the stock spread;
- the demo buyer in the demo organisation, with a credit limit;
- the product attributes, the placeholder images and the sample attachments.

`pnpm run cli demo reset` withdraws exactly what it created, before the modules withdraw their
own rows.

## How an instance gets it

Ask for demo data when you scaffold — `endora install --demo` or `endora new instance --demo` —
and this package joins your module list. To add it to an instance that already exists:

```bash
pnpm add @endora-commerce/demo-composition
pnpm run cli demo seed
```

The seed is idempotent: rows already there are joined, not duplicated. **It adopts your
system-default sales channel and renames it `pl_retail`**, so a storefront configured with that
channel's previous code has to be pointed at the new one.

No file is written into your tree. The platform finds the package by its `package.json`
declaration, `"endora": { "type": "demo-composition" }`, the way it finds a module package by
`"module"`. An instance that installs no such package seeds only the modules' own rows and says
so once.

## Every module is optional

Each step names the modules whose rows it touches, and runs only when every one of them is
installed and switched on; otherwise it is reported as skipped, with the reason. The module
packages are optional peer dependencies and are imported only by the steps that run, so an
instance with a smaller module set can still install and run it.

## Entry points

- `@endora-commerce/demo-composition` — `createDemoComposition(input)`, which the platform calls,
  and the attribute helpers (`createAttributeFixture`, `findAttributeDefinitionByKey`,
  `findAttributeExtensionByKey`) the platform repository's own test fixtures share with it.

## What the tarball carries

- `dist/` — the compiled JavaScript and its type declarations
