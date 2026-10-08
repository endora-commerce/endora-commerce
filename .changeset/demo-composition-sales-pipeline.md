---
'@endora-commerce/demo-composition': minor
---

The demo shop gains a sales pipeline. A new step, `sales opportunities for the demo
organisation`, creates twelve CRM opportunities for the demo organisation — two in each status of
the default workflow (`new`, `qualified`, `proposal`, `negotiation`, `won`, `lost`) — assigned
across the two demo sales representatives with one left unassigned, with status history dated
over the three months before the seed, the `crm` module's demo tags, the demo buyer as contact
person on four of them, six notes and internal messages, and references to a demo product and to
a person. Eleven carry a value entered by hand and one is set to be calculated from its linked
documents. None is linked to an order or a quote request: the demo shop has neither.

`pnpm run cli demo seed` adds the pipeline to a shop that is already seeded and leaves an
opportunity that is already there untouched; `pnpm run cli demo reset` removes exactly these
twelve, by id. The step runs only when `crm`, `organizations`, `admin_users`,
`customer_accounts` and `catalog` are all installed and switched on, and is reported as skipped
otherwise. The rows are written directly rather than through CRM's commands, so a seeded
opportunity's History tab is empty.

**Run `demo reset` with CRM switched on.** While `crm` is off the step is skipped in both
directions, the opportunities keep referencing the demo organisation, and the reset stops at
`organizations` with a foreign-key refusal.

Two peers are new: `@endora-commerce/mod-crm` (optional, like every module this package wires)
and `@endora-commerce/contracts`, which an instance already installs for its modules.
