---
title: crm
description: Sales opportunities with a configurable status workflow that linked orders follow
---

# `crm`

The CRM module keeps track of **sales opportunities**: a deal a sales
representative is working with one customer organization, from the first
contact to the moment it is won or lost.

This page grows with the module. The sections marked *coming* describe
capabilities that are designed and not yet shipped.

## What it does

An opportunity belongs to exactly one organization and moves through a
**status workflow** the operator configures: a set of statuses and the
transitions allowed between them. Every status is one of three kinds:

- **open** — the opportunity is still being worked;
- **won** — the opportunity is closed and the deal was made;
- **lost** — the opportunity is closed without a deal.

A fresh installation starts with a default workflow of six statuses:

| Code | Kind | Moves to |
| --- | --- | --- |
| `new` (the start status) | open | `qualified`, `lost` |
| `qualified` | open | `proposal`, `lost` |
| `proposal` | open | `negotiation`, `won`, `lost` |
| `negotiation` | open | `won`, `lost` |
| `won` | won | — |
| `lost` | lost | `new` |

A closed opportunity is not necessarily finished: `lost` can move back to
`new`, so a deal that comes back to life is reopened rather than re-entered.

Opportunities are visible according to the organizations an administrator may
see. An administrator restricted to a set of organizations sees only those
organizations' opportunities; to them, another organization's opportunity does
not exist.

## Configuring the workflow

The workflow is the operator's. A status has a **code** (lowercase letters,
digits and underscores; it never changes once created), a name per language, a
kind, a colour and a weight that orders it on screen. Exactly one status is the
**start status** — the one a new opportunity begins in — and it must be an open
one.

A transition is a directed step from one status to another. An opportunity can
only make a step that is configured, so the set of transitions is what the
status control offers a sales representative. A closing status may have
transitions out of it: reopening is a transition like any other.

A change that would leave the workflow broken is refused, and the refusal says
which rule it would break:

| Rule | What it protects |
| --- | --- |
| `exactly_one_initial` | There is one start status, never none and never two. |
| `initial_must_be_open` | A new opportunity does not start closed. |
| `won_status_required` | An opportunity can always be closed as won. |
| `lost_status_required` | An opportunity can always be closed as lost. |
| `transition_unknown_status` | A transition connects two statuses that exist. |
| `mapping_unknown_status` | A mapping names an opportunity status that exists. |
| `mapping_duplicate` | An opportunity status maps to one order status, not several. |

A status that opportunities are in cannot be deleted and cannot change its
kind; move the opportunities first. The start status cannot be deleted either —
make another status the start status, then delete it. Deleting a status removes
its transitions and its mappings with it.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/workflow` | `crm:read` | The configured statuses, with how many opportunities are in each, the transitions between them, the order-status mappings and the statuses that count toward a computed value. |
| `POST /api/v1/admin/crm/statuses` | `crm:configure` | Add a status. |
| `PATCH /api/v1/admin/crm/statuses/:code` | `crm:configure` | Rename or recolour a status, change its kind, or make it the start status. |
| `DELETE /api/v1/admin/crm/statuses/:code` | `crm:configure` | Delete a status no opportunity is in. |
| `PUT /api/v1/admin/crm/transitions` | `crm:configure` | Add and remove transitions. |
| `PUT /api/v1/admin/crm/order-status-mappings` | `crm:configure` | Replace the set of order-status mappings. |

Every one of these writes answers the whole workflow as it stands afterwards.

## Working an opportunity

An opportunity is created for one organization, in one currency; neither can be
changed afterwards. It gets a number of its own (`OPP-000123`) and begins in
the start status. It can carry a description, a contact person — who must be a
member of that organization — a sales channel, a value and an expected close
date.

Moving an opportunity records who moved it, when, from which status to which,
and the reason if one was given. Entering a status of kind **won** or **lost**
closes the opportunity and stamps the moment; leaving one reopens it.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/opportunities` | `crm:read` | List, with search (title, number, organization name), filters by status, by state (`open` / `won` / `lost`), organization, sales channel and creation date, sorting and paging. |
| `POST /api/v1/admin/crm/opportunities` | `crm:write` | Create an opportunity. |
| `GET /api/v1/admin/crm/opportunities/:id` | `crm:read` | One opportunity, with the statuses it may move to, its linked orders and any order change that was refused. |
| `PATCH /api/v1/admin/crm/opportunities/:id` | `crm:write` | Edit it. Send the version you read in `If-Match`; a stale one is refused with `409`. |
| `DELETE /api/v1/admin/crm/opportunities/:id` | `crm:configure` | Delete it, with its links and history. |
| `POST /api/v1/admin/crm/opportunities/:id/transition` | `crm:write` | Move it to another status. |

## Linking orders

An existing order can be linked to an opportunity. The order must belong to the
opportunity's organization, and an order belongs to **at most one**
opportunity — linking one that is already linked is refused, naming the
opportunity that holds it.

Each link has a switch, **follow the opportunity's status**, on by default.
Switch it off for an order that should stay linked — for reference, or for its
value — without being moved.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `POST /api/v1/admin/crm/opportunities/:id/links` | `crm:write` | Link an order. |
| `PATCH /api/v1/admin/crm/opportunities/:id/links/:linkId` | `crm:write` | Switch status following on or off. |
| `DELETE /api/v1/admin/crm/opportunities/:id/links/:linkId` | `crm:write` | Unlink. |

## Orders that follow an opportunity

A **mapping** says: when an opportunity enters *this* status, ask its linked
orders to enter *that* order status. One opportunity status maps to at most one
order status, and a status with no mapping asks nothing of anybody.

When an opportunity moves, every linked order that follows it is asked, each on
its own. The request goes through the order workflow's own rules — the
transitions configured for orders, and anything else that may refuse an order
change — exactly as if an administrator had changed the order by hand. Nothing
is forced.

**The opportunity's move stands whatever the orders answer.** A refusal is not
an error: the opportunity has moved, and what became of each order is reported
beside it.

| Outcome | What happened to the order |
| --- | --- |
| `applied` | It moved to the mapped status. |
| `already_there` | It was already in the mapped status; nothing changed. |
| `not_permitted` | The order workflow has no transition from the order's current status to the mapped one — or the order is in a final status. |
| `vetoed` | Something watching order changes refused this one; the reason is given. |
| `unknown_status` | The mapping names an order status that no longer exists. Correct the mapping. |
| `not_found` | The linked order no longer exists. |
| `failed` | The request did not complete. The reason is given, and it can be retried. |

Every outcome except the first two stays on the opportunity as **unresolved**
until somebody deals with it:

- **Retry** asks the order again — after the mapping was corrected, or the
  order moved to a status the mapped one can follow. The order is asked for
  what the opportunity's status maps to *now*.
- **Dismiss** acknowledges the refusal and leaves the order where it is.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `POST /api/v1/admin/crm/opportunities/:id/propagations/:propagationId/retry` | `crm:write` | Ask the order again. |
| `POST /api/v1/admin/crm/opportunities/:id/propagations/:propagationId/dismiss` | `crm:write` | Acknowledge a refusal. |

## Adding your own logic to a status change

Another module — typically a per-deployment overlay module — can react to an
opportunity moving from status X to status Y, and can refuse the move. Both
seams are published in `@endora-commerce/contracts`; neither needs a change to
CRM.

**React to a move** by subscribing to an event. For a move from `x` to `y`, CRM
emits, in this order:

| Event | When |
| --- | --- |
| `crm.opportunity.status.from_<x>_to_<y>.before` | before the change is written |
| `crm.opportunity.status.from_<x>.before` | before the change is written |
| `crm.opportunity.status_changed.v1` | after it is saved and the linked orders have been asked |
| `crm.opportunity.status.from_<x>_to_<y>.after` | same |
| `crm.opportunity.status.to_<y>.after` | same |
| `crm.opportunity.closed.v1` | same, when `y` closes the opportunity |

The names are built by `opportunityStatusEventName`, so a subscriber does not
spell the pattern. A subscriber cannot stop the move, and one that fails does
not undo it.

```ts
ctx.subscribe(opportunityStatusEventName('toAfter', { to: 'won' }), async (event) => {
  await notifyFinance(event.opportunityId);
});
```

**Refuse a move** by registering a guard. A guard names the moves it watches —
from a status, to a status, or both — and refuses by throwing
`OpportunityTransitionVetoError`. The sentence it throws is what the sales
representative reads; nothing is written when a guard refuses.

```ts
ctx.onBoot(() => {
  lazyPort<OpportunityTransitionGuardRegistryPort>(ctx, 'opportunityTransitionGuardRegistry').register({
    ownerModuleId: 'acme_rules',
    match: { to: 'won' },
    guard: (event) => {
      if (event.reason === null) throw new OpportunityTransitionVetoError('Say why the deal was won.', event.from, event.to);
    },
  });
});
```

The module that registers a guard declares it in its manifest:
`nonBindingDependencies: [{ moduleId: 'crm', name: 'opportunityTransitionGuardRegistry', kind: 'contributes-to' }]`.
A guard belonging to a module that is switched off is skipped — a module that is
off does not refuse anything.

## Switching it on and off

CRM is an optional module. It is on by default and an operator switches it
off, and back on, on the **Modules** screen of the Admin UI
(`/platform/modules`).

While it is off:

- every `/api/v1/admin/crm/…` endpoint answers `503` with the code
  `MODULE_DISABLED`;
- its screens, sidebar group, command-palette entries and settings disappear
  from the Admin UI;
- its permissions can no longer be granted to a role;
- nothing it would do in the background happens.

Nothing is deleted. Every opportunity, its history and the workflow
configuration stay in the database, and everything is back exactly as it was
when the module is switched on again.

## Permissions

| Code | What it allows |
| --- | --- |
| `crm:read` | View sales opportunities and the status workflow. |
| `crm:write` | Create and edit opportunities, move them through the workflow, link and unlink orders, retry or dismiss a refused order change. |
| `crm:configure` | Change the workflow — statuses, transitions and order-status mappings — and delete an opportunity. |

A role that holds `crm:read` should also hold `orders:read`: an opportunity
shows the orders linked to it, and those are read from the Orders module.
`crm:write` and `crm:configure` each build on `crm:read`.

No role receives a CRM permission automatically. Grant them on the
**Roles** screen.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `crm.enabled` | on | The switch described above. |
| `crm.auto_create_from_orders` | off | *Coming.* Create an opportunity for every newly placed order. |
| `crm.auto_create_from_quote_requests` | off | *Coming.* Create an opportunity for every newly submitted quote request. |

## Coming

- Screens in the Admin UI for everything above.
- Moving an opportunity when one of its orders reaches a given status.
- Assigning opportunities to sales representatives.
- Notes, internal messages, attachments and tags.
- A board view with a column per status.
- Linking quote requests, and a value computed from the linked documents.
- A change history for every opportunity.
- Analytics: handling time, time in each status, results by sales
  representative.

## An order that moves its opportunity

The mapping also runs the other way: when a linked order reaches *this* order
status, move its opportunity to *that* status. One order status maps to at most
one opportunity status; several order statuses may lead to the same one.

It does not matter who changed the order — an administrator, a payment that
arrived, a shipment that was sent. The opportunity follows, through its own
workflow: the transition must exist, anything registered to refuse it may
refuse it, and everything that listens to an opportunity's status change hears
this one too. The change is recorded as caused by the order, and names it; no
administrator is recorded as having made it.

| Situation | What happens |
| --- | --- |
| The order does not follow its opportunity (status following is off), or is linked to none | Nothing. |
| The opportunity is already closed, won or lost | Nothing. **A mapping never reopens a closed opportunity.** |
| The workflow has no transition from the opportunity's status to the mapped one, or something refused it | The opportunity stays where it is, and the skipped change is recorded on it with the reason. |
| The mapping is marked *only when every linked order is there* | The opportunity waits until every linked order that follows it is in an order status mapped to that same opportunity status. |

**Mappings in both directions do not loop.** A change goes one hop and stops:

- when an opportunity moves and its orders follow, those orders' changes are
  recognised as the opportunity's own and do not move it again;
- when an order moves its opportunity, no other order of that opportunity is
  asked to follow.

A mapping is sent to the same endpoint as the forward ones, with
`direction: "order_to_opportunity"` and, optionally, `requireAllOrders`. The
set is replaced whole, both directions together:

```json
{
  "mappings": [
    { "direction": "opportunity_to_order", "opportunityStatusCode": "won", "orderStatusCode": "completed" },
    { "direction": "order_to_opportunity", "orderStatusCode": "completed", "opportunityStatusCode": "won", "requireAllOrders": true }
  ]
}
```

One rule joins the ones above: `mapping_duplicate_order_status` — an order
status moves an opportunity to one status, not several.

`GET /api/v1/admin/crm/workflow` reports `orderStatusKnown` for every mapping.
It turns `false` once the Orders module has answered that the order status does
not exist, and back to `true` when an order next accepts it; a mapping nobody
has used yet reads `true`.

While the module is switched off, an order's status change moves nothing, and
it is not caught up afterwards.

## Who holds an opportunity

Every opportunity has at most one **assignee** — the person working it. Any
active administrator may be the assignee.

When an opportunity is created without saying who holds it, the assignee is
chosen from the sales representatives assigned to the opportunity's
organization:

1. the person creating the opportunity, if they are one of them;
2. otherwise the one who has been assigned to the organization the longest;
3. otherwise nobody — the opportunity is created unassigned.

A sales representative who has been deactivated is passed over. A request that
names an assignee, or says explicitly that there is none, is taken at its word
and the rule does not apply.

**The assignee does not decide who can see an opportunity.** A sales
representative restricted to certain organizations sees every opportunity of
those organizations, whoever holds it — and does not see an opportunity of
another organization even when it is assigned to them.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `POST /api/v1/admin/crm/opportunities/:id/assign` | `crm:write` | Assign, reassign, or — with `{ "adminUserId": null }` — unassign. Answers the opportunity. |
| `GET /api/v1/admin/crm/opportunities?assignedAdminUserId=…` | `crm:read` | `me` for the caller's own, `unassigned`, or an administrator's id. |

Somebody who is not an active administrator cannot be assigned: the request is
refused with `CRM_ASSIGNEE_INVALID`. Editing an opportunity may change its
assignee too, under the same rule.

A person is told when an opportunity becomes theirs — on the notification bell
of the Admin UI, with a link to the opportunity. Nobody is told about taking an
opportunity themselves. The bell belongs to the **Admin notifications** module:
while that module is switched off, assigning works exactly as before and nobody
is notified.

Every assignment is in the opportunity's change history, and other modules can
react to it: `crm.opportunity.assigned.v1` carries the new and the previous
assignee.
