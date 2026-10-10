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
- the product attributes, the placeholder images and the sample attachments;
- a sales pipeline on the CRM board: twelve opportunities for the demo organisation, two in each
  status of the default workflow, assigned across the two sales representatives (one is left
  unassigned), with status history spread over the last three months, tags, notes and an internal
  message. None is linked to an order or a quote request — the demo shop has neither.

`pnpm run cli demo reset` withdraws exactly what it created, before the modules withdraw their
own rows.

A demo that has been used resets too. Before any step is unwound, the reset removes what using
the demo created under the demo organisation and its customer accounts — orders with their
shipments, stock allocations (the stock they held is released) and credit reservations, return
cases, carts, quote requests, shopping lists, saved addresses, API keys, webhooks, sessions, the
accounts that joined the organisation, promotion uses (the limits they spent are given back), and
any Sales Opportunity opened for that organisation. They are deleted, not re-pointed: the
organisation they belong to is withdrawn, and every row here belongs to exactly one. Only rows of
the demo organisation are matched — it is found by the tax id the demo gives it — so another
organisation on the same instance loses nothing, and neither does a row that belongs to no
organisation, such as a guest's cart.

**The whole reset is one transaction.** It either completes or changes nothing: if a foreign key
refuses it anywhere — a table of your own that references an order or a product, say — the
command exits non-zero and the shop still works.

**It refuses when the demo organisation holds financial records**, and says how many of each it
found. What counts:

- a payment whose status is `paid`, `refunded` or `partially_refunded`;
- an invoice of kind `invoice` or `correction` — or of any kind that carries a KSeF reference
  number or an external document reference, or that has an accounting-system row;
- any row of `invoice_ledger_deliveries`, `invoice_ledger_document_maps` or
  `invoice_ledger_client_maps`, in either environment;
- a refund, and a refund settled against the credit limit.

What does not: a payment still `awaiting_payment`, `deferred` or `failed`, a pro-forma invoice or
a delivery note with no external reference. Those are what a placement opens, and they are
withdrawn with their order — so a demo on which orders were placed and nothing was paid resets as
it is. Where the data is disposable:

```bash
pnpm run cli demo reset --force-delete-financial-records
```

The flag is read from that command line only; no environment variable or setting stands in for
it. It deletes the kinds listed above and forces nothing else — the production guard and every
foreign key apply as before.

If you write a composition of your own: every statement of `withdraw` and `withdrawFoundation`
goes through the `EntityManager` the composition is built over (`em.execute`, `em.nativeDelete`),
never through `em.getConnection()`, `em.getKnex()` or a fork — those take a second connection,
outside the reset's transaction. Declare `withdrawsInsideTransaction: true` on the object you
return once that holds; the reset refuses a composition that does not, and refuses on the spot a
body that asks for a connection of its own. As a last resort the transaction's waits are bounded
(a minute for a lock, two idle), so a body that bypasses all of this ends the reset instead of
hanging it.

A module being switched off does not exempt its rows: an Opportunity or a return case of the demo
organisation is withdrawn whether or not its module is active, because it refers to the
organisation either way. What decides is whether the module's tables exist.

It also stops, before touching anything, when another organisation has been filed under the demo
one: detach or delete the sub-organisation and run it again.

Three records are kept on purpose, because they are logs of what happened rather than data of
the demo organisation: the audit trail, the e-mail delivery log and administrators'
notification history.

A module that is not part of this package's repository is not covered: a table of its own that
holds a foreign key onto one of these rows refuses the reset (with or without the flag), and one
that holds a bare id is left naming a row that is gone. There is no extension point yet for such
a module to add its own withdrawal.

## How an instance gets it

Ask for demo data when you scaffold — `endora install --demo` or `endora new instance --demo` —
and this package joins your module list. To add it to an instance that already exists, at the
instance root — a pnpm workspace, hence `-w`:

```bash
pnpm add -w @endora-commerce/demo-composition
pnpm run cli demo seed
```

The seed is idempotent: rows already there are joined, not duplicated. It adopts your
system-default sales channel as the demo's retail channel and sets its languages (`pl-PL`,
`en-US`) and currencies (`PLN`, `EUR`). It keeps the channel's code when you chose one
(`DEFAULT_SALES_CHANNEL_CODE`), so the storefront built against it keeps finding it, and names it
`pl_retail` only when it still carries the platform's fallback code, `default`.

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
