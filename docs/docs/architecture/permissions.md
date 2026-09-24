---
title: Permissions — three notions, and which one you are looking at
---

# Permissions

An admin permission in this platform is a code, and a code has **three separate
notions attached to it**. Only one of them used to be visible anywhere, and that
is why this page exists: a reader who sees `module: 'quote_requests'` on
`rfqs:handle` reasonably concludes that `quote_requests` is the one thing that
decides whether the code is there. That conclusion is wrong often enough to have
caused a shipped defect; an audit found five instances of it.

## 1. `module` — a display grouping

`module` is the heading the role editor files a code under. Nothing more.

It is **not** guaranteed to be a module id: `_lifecycle` declares its codes under
`module: 'module_lifecycle'`, which names no module in any deployment. Filtering
anything on `module` therefore deletes the lifecycle permissions from every
platform that tries it.

## 2. `owners` — whose presence keeps the code grantable

`owners` is the **set** of modules that declare the code. `/admin-roles` offers
the code while **any** owner is effectively present — both axes of module
presence, platform availability *and* operator activation.

It is a set because a code can be shared. `integrations:manage` gates the API
keys admin surface and the webhooks one, and both `api_keys` and `webhooks`
declare it; switching `webhooks` off must not take the API keys screen's own gate
off the role editor. Co-declaration is the mechanism, and it is the repair for a
module that enforces a code another module owns — see *foreign gates* below.

`owners` and `module` are different strings and treating them as one is a defect
waiting to happen. Both are on the wire on `GET /api/v1/admin/permissions`, and
the role editor shows the owner set wherever it says something the grouping does
not.

## 3. The vocabulary, and the grantable set inside it

Two questions, deliberately answered differently:

| Question | Method | Presence-filtered |
| --- | --- | --- |
| What may an operator **newly grant**? | `listAssignable()` | yes |
| What codes does the platform **know**? | `listKnownCodes()` | no |

A role upsert validates against the **vocabulary**, never the grantable set, and
the difference is what keeps *"switching a module off is non-destructive and
reversible"* true. An "Editor" role holds `blog.read`; an operator switches
`blog` off and then renames the role. Validating the submitted list against the
grantable set would answer `400 Unknown permission(s): blog.read` — so the
operator either loses the role or silently drops a grant that has to come back
when `blog` does. The grant is harmless meanwhile: the routes behind it answer
`503 MODULE_DISABLED` at their own seam.

The role editor relies on this. It seeds its selection from the **role's** codes
and renders a checkbox only for the ones the catalogue offers, so an absent
module's grant survives the round trip with no checkbox to un-tick.

`PermissionCatalogueService`
(`packages/modules/admin_roles/src/backend/services/permission-catalogue.service.ts`)
is where all three notions are merged, and it is the only place they are.

## Foreign gates: enforcing a code you do not own

A module may enforce a permission code another module owns. Nothing declares
that coupling, and the cost is one-directional: the owner's presence decides
whether the code is offered, so switching the owner off takes the code off
`/admin-roles` while the consumer's routes — if the consumer cannot be switched
off with it — go on enforcing it. The screen sits there behind a permission
nobody can be granted.

It is **derived, not declared**. `backend/test/helpers/foreign-gates.ts` reads
every enforcement site the permission inventory resolves and every manifest, and
classifies each pair; every verdict comes off the manifests on every run, so
withdrawing a module's `nonDeactivatable` lock re-opens every finding that was
resting on it, in the same pipeline, with no ledger to edit.

Three repairs, in the order to reach for them:

1. **The consumer gates on a code it owns.** Apply the label test: does the
   code's label read as a sentence about the consumer's own screen? *"Handle
   quote requests"* is not a sentence about a price-resolution endpoint, so
   `price_lists` gates that route with `price_lists:read`.
2. **Both modules declare the code**, making the consumer a second owner, so the
   code survives while either surface is on. This is the shape `api_keys` and
   `webhooks` already use.
3. **Declare the owner in `dependencies`** — last, and usually wrong. A consumer
   that cannot be switched off, declaring an owner that can, makes the lifecycle
   orchestrator refuse to switch that owner off at all: the operator-toggleable
   rule inverted, decided by somebody else's manifest.

## Declared dependencies: `requires`

A permission declaration may name other codes a role holding it needs:

```ts
permissions: [
  { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
],
```

It is **advisory and costs nothing at runtime**. No guard reads it, no upsert is
refused, and it is not a lifecycle edge — it puts no module in anybody's
`dependencies`. What it does is put a sentence where an operator can read it: the
role editor shows the shortfall for the codes currently ticked, with a one-click
add, and a role saved without them is saved.

The example above is real. `RfqCreatePage` prefills an agreed price from a
`price_lists` route deliberately gated with `price_lists:read`, so a
role holding only `rfqs:handle` loses the prefill and falls back to manual entry.
That sentence was written in a ruling, in a route comment and in a seed, and in
nothing an operator could read.

**Do not write a derived fact here.** *A module enforces a code another module
owns* is the previous section's question, it is derived from the gates and the
manifests, and declaring it in a manifest as well would be two answers to one
question waiting to disagree. `requires` carries something no instrument in this
repository can work out: a coupling that runs from an admin screen's own fetches
to another module's route, plus the judgement of whether a role without the
second code is broken or merely degraded in a way somebody accepted.

What *is* machine-checked is that a requirement names a code the platform's
vocabulary holds — a typo, or a code its owner renamed, would otherwise advise an
operator forever to grant something that does not exist. That is
`backend/test/contract/admin_users/permission-inventory.test.ts`, in the same
file as the inventory's two-way sweep, because the inventory already reads every
manifest code and two derivations of one population are two answers waiting to
disagree.

A code more than one module declares takes the **union** of its declarers'
requirements: a shared code opens more than one surface, each with its own needs,
and advising more is the direction that cannot strand anybody.

## Adding a permission

Declare the code in your own module's `manifest.ts`, label it in your own module's
`i18n/en.json` and `i18n/pl.json` under `adminRoles.permission.<code>`, enforce it
with a `requireAdmin('…')` literal that matches exactly, and run

```bash
pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts
pnpm --filter backend run check:action-route-permissions
```

The first sweeps both directions — every enforced code is grantable, every
grantable code is enforced — plus label coverage and the `requires` declarations.
The second answers a question the two-direction sweep structurally cannot:
whether the code a palette action declares is the one enforced on that action's
own route.
