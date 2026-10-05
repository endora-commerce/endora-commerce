---
title: crm
description: Sales opportunities with a configurable status workflow that linked orders follow
---

# `crm`

The CRM module keeps track of **sales opportunities**: a deal a sales
representative is working with one customer organization, from the first
contact to the moment it is won or lost.

This page grows with the module. Whatever is marked *coming* is designed and
not yet shipped.

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

## In the Admin UI

The module adds a **CRM** group to the sidebar, directly after *Sales*. An
administrator sees the entries their role allows, and the group itself only
when at least one of them is visible.

| Screen | Where | Permission | What it is for |
| --- | --- | --- | --- |
| Opportunities | **CRM → Opportunities** (`/crm/opportunities`) | `crm:read` | Every opportunity you may see, with search and filters by state, status, organization, assignee, tags, sales channel and creation date. |
| New opportunity | the **New opportunity** button (`/crm/opportunities/new`) | `crm:write` | Create an opportunity by hand: a title, the organization and the currency are required; a contact person, a sales channel, an expected value, an expected close date and a description are optional. |
| An opportunity | a row of the list (`/crm/opportunities/:id`) | `crm:read` | Its status and the moves the workflow allows from it, the orders linked to it, and what became of those orders after each move. |
| Board | **CRM → Board** (`/crm/board`) | `crm:read` | The same opportunities as cards, in a column per status. A holder of `crm:write` moves a card to another status. |
| Tags | **CRM → Tags** (`/crm/tags`) | `crm:configure` | The tag list: add, rename, recolour and delete the labels opportunities may carry. |
| Workflow | **CRM → Workflow** (`/crm/workflow`) | `crm:configure` | The statuses, the transitions between them, the order status each opportunity status sets, and the opportunity status each order status leads to. |

The everyday screens are also in the command palette (`⌘K` / `Ctrl+K`):
**Sales opportunities**, **New sales opportunity** and **Opportunity board**.

A first walk through the module, start to finish:

1. On **Workflow**, check the statuses — which one is the start status, which
   close an opportunity as won or lost — and the arrows between them. Under
   *Order status for each opportunity status*, choose what each status should
   do to a linked order, and save.
2. On **Opportunities**, press **New opportunity**, fill in the title, the
   organization and the currency, and create it. You land on the opportunity.
3. Under *Linked orders*, search the organization's orders by number and link
   one. It follows the opportunity's status unless you untick that for it.
4. Under *Status*, press the status to move to. Only the moves the workflow
   allows are offered.
5. Under *Order status changes*, read what happened to each linked order. An
   order that could not be moved is listed with the reason and two buttons,
   **Retry** and **Dismiss**; it stays there, on every later visit, until one of
   them is pressed.

An administrator who may read but not write sees the same screens without the
controls that change anything.

## Configuring the workflow

The workflow is the operator's. A status has a **code** (lowercase letters,
digits and underscores; it never changes once created), a name per language, a
kind, a colour and a weight that orders it on screen. Exactly one status is the
**start status** — the one a new opportunity begins in — and it must be an open
one.

A transition is a directed step from one status to another. An opportunity can
only make a step that is configured, so the set of transitions is what the
status control offers a sales representative. A closing status may have
transitions out of it: reopening is a transition like any other. On the
**Workflow** screen transitions are drawn as a graph; add one by choosing its
two ends under the graph, or by pressing **Connect** and clicking the two
statuses, and remove one by selecting its arrow.

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
| `mapping_duplicate_order_status` | An order status moves an opportunity to one status, not several. |

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
| `GET /api/v1/admin/crm/opportunities` | `crm:read` | List, with search (title, number, organization name), filters by status, by state (`open` / `won` / `lost`), organization, assignee, tags, sales channel and creation date, sorting and paging. |
| `POST /api/v1/admin/crm/opportunities` | `crm:write` | Create an opportunity. |
| `GET /api/v1/admin/crm/opportunities/:id` | `crm:read` | One opportunity, with the statuses it may move to, its linked orders and any order change that was refused. |
| `PATCH /api/v1/admin/crm/opportunities/:id` | `crm:write` | Edit it. Send the version you read in `If-Match`; a stale one is refused with `409`. |
| `DELETE /api/v1/admin/crm/opportunities/:id` | `crm:configure` | Delete it, with its links and history. |
| `POST /api/v1/admin/crm/opportunities/:id/transition` | `crm:write` | Move it to another status. |

## Editing and deleting an opportunity

On an opportunity's screen, **Edit** — beside the *Details* heading, for a
holder of `crm:write` — turns the details into a form: the title, the
description, the contact person, the sales channel, the expected close date and
the value. The organization and the currency are shown and cannot be changed.
The value is either **entered by hand** or **calculated from linked
documents**; the figure you entered is kept while the calculated one is shown.

Saving sends only the fields you changed. If the opportunity was changed in the
meantime — by a colleague, or by a status change you made yourself while the
form was open — nothing is saved and the form says so: press **Reload the
opportunity** to see the latest version, then make your changes again. Nothing
is ever overwritten silently.

A status change can carry a **reason**: write it in the field under the status
buttons before pressing one. It is optional and is recorded with the change.

**Delete**, in the header of the screen, is for a holder of `crm:configure`. It
asks first, and removes the opportunity together with its status history and
its links; the linked orders themselves are not touched.

## The board

**CRM → Board** shows the opportunities you may see as cards, in one column per
status, in the workflow's order. Each column's header carries the number of
opportunities in that status and their value, one total per currency; each card
shows the opportunity's title, number, organization, value, who it is assigned
to and its tags. The card's title opens the opportunity.

A card is moved to another status in either of two ways, and both do exactly
what the status buttons on the opportunity's own screen do — linked orders
included:

- **Drag it** to another column: with a mouse; on a touch screen by pressing
  the card for a moment and then dragging; or with the keyboard — focus the
  grip at the card's left edge, press Space or Enter to pick the card up, the
  left and right arrow keys to choose a column, Space or Enter to drop it, and
  Escape to cancel. While a card is lifted, the columns the workflow does not
  allow it to enter are dimmed and marked, and a drop on one changes nothing.
- **Use the card's "Move to…" menu**, which lists exactly the statuses the
  workflow allows from where the card is. It needs no dragging at all.

The card moves at once. If the move is refused — the workflow no longer allows
it, a business rule vetoes it, or somebody moved the opportunity first — the
card returns to its column and the reason is shown above the board. If the move
succeeds but a linked order could not follow, the opportunity stays moved: the
card is marked, and a notice above the board names each order with the reason
and links to the opportunity, where the change can be retried or dismissed.

The search box and the organization, assignee, tags, sales channel and
creation-date filters are the list's, and narrow every column, its count and its totals alike. A
column that holds more opportunities than are shown says how many, with **Show
more**.

An administrator who may read but not write sees the board without the grips
and the menus.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/board` | `crm:read` | One column per status, in workflow order: the status, `count`, `valueTotals` per currency, the first `perColumn` opportunities (default 50, at most 200) and `hasMore`. Takes the list's filters except `statusCode` and `state` — the assignee and tag filters included, with the same meaning. |

There is no board-specific write: moving a card is
`POST /api/v1/admin/crm/opportunities/:id/transition`. A column is continued
from the list endpoint, filtered to that status.

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

On the **Workflow** screen these mappings are the second table, *Opportunity
status for each order status*: one row per order status, a choice of the
opportunity status it leads to, and a checkbox, **Only when every linked order
is there**. The checkbox is ticked for you when the chosen status closes the
opportunity — one delivered order out of three should not win the deal — and
left clear otherwise; change it either way before saving. A mapping whose
order status has since been deleted from the order workflow stays in the table,
marked *no longer exists*, until you set its row back to *Leave the opportunity
as it is*. **Save mappings** saves both tables together.

Over the API, a mapping is sent to the same endpoint as the forward ones, with
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

In the Admin UI:

- **On the new-opportunity form** the *Assignee* field is optional. Leave it
  empty and the rule above chooses; pick a person and it is theirs.
- **On an opportunity**, the *Assignee* section names who holds it. A holder of
  `crm:write` changes it there: choosing a person assigns the opportunity to
  them at once, and clearing the field leaves it unassigned. There is nothing
  to save.
- **On the list** there is an *Assignee* column, and both the list and the
  board have an *Assignee* filter: **Anyone**, **Mine**, **Unassigned**, or
  **A specific person…**, which adds a field to choose them.
- An assignee whose account has since been deactivated is marked **inactive**
  wherever their name is shown — the list, the board's cards and the
  opportunity. The opportunity stays theirs until somebody reassigns it.

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

## Tags

A **tag** is a short label with a colour — *Key account*, *Tender*, *Renewal* —
that an opportunity may carry, any number of them. There is one tag list for
the whole platform.

- Tag names are unique whatever their case: *Tender* and *TENDER* are the same
  name, and the second is refused with `CRM_TAG_NAME_TAKEN`.
- Renaming or recolouring a tag changes it on every opportunity that carries
  it.
- Deleting a tag takes it off every opportunity that carried it. Nothing else
  about those opportunities changes.
- The list of opportunities can be filtered by tags. Several tags mean *all of
  them*: an opportunity is listed only when it carries every tag named.
- Each tag shows how many opportunities carry it — counted over the
  opportunities the person asking may see, not over the whole platform.

Managing the tag list is configuration and needs `crm:configure`. Putting tags
on an opportunity is everyday work and needs `crm:write`.

In the Admin UI:

- **CRM → Tags** is the tag list, with how many of the opportunities you can
  see carry each tag. **Add tag** opens a small form with a name and a colour;
  the pencil renames or recolours; the bin deletes, after a confirmation that
  says how many opportunities will lose the tag.
- **On an opportunity**, the *Tags* section shows its tags. A holder of
  `crm:write` ticks and unticks them in the list under it; each change is saved
  at once.
- **On the new-opportunity form** the *Tags* field sets them from the start.
- **On the list and the board** the *Tags (all of them)* filter narrows to the
  opportunities carrying every tag ticked. The list shows each opportunity's
  tags under its title, the board on its card.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/tags` | `crm:read` | The tag list, by name, each with `usageCount`. |
| `POST /api/v1/admin/crm/tags` | `crm:configure` | Create a tag: `{ "name", "color"? }`. |
| `PATCH /api/v1/admin/crm/tags/:id` | `crm:configure` | Rename or recolour. |
| `DELETE /api/v1/admin/crm/tags/:id` | `crm:configure` | Delete, and untag every opportunity. |
| `PUT /api/v1/admin/crm/opportunities/:id/tags` | `crm:write` | Replace the opportunity's tags: `{ "tagIds": [...] }`. Answers the opportunity. |
| `GET /api/v1/admin/crm/opportunities?tagId=…&tagId=…` | `crm:read` | Opportunities carrying every tag named. |

Creating or editing an opportunity may set its tags too, with `tagIds`. A tag
that does not exist is refused, and nothing is changed.

## Notes and internal messages

People working an opportunity write on it in two ways.

A **note** is something to remember — what the customer said, what was agreed,
what to do next. Whoever wrote a note may edit it or delete it; nobody else
may, whatever their permissions. An edited note shows that it was edited. A
deleted note is no longer listed, and what it said stays in the opportunity's
change history.

A **message** is part of a conversation between the people working the
opportunity. Messages are listed in the order they were sent, and **a message
cannot be changed or deleted once it is sent** — not by its author, not by
anybody: the attempt is refused with `CRM_MESSAGE_IMMUTABLE`. A message tells
the opportunity's assignee and everybody who has already written in that
conversation, except the person who sent it, on the notification bell of the
Admin UI with a link to the opportunity. While the **Admin notifications**
module is switched off, a message is stored all the same and nobody is told.

**Both are internal.** Neither a note nor a message has a setting that shows it
to the customer, and nothing the customer can open — an order, a quote request,
their account — carries either.

In the Admin UI an opportunity has a **Notes** tab and a **Messages** tab. Each
lists its entries oldest first, with who wrote each and when, and — for a
holder of `crm:write` — a field under the list to write the next one.

- On **Notes**, your own notes carry **Edit** and **Delete**; a colleague's
  carry neither. An edited note is marked *edited*. Deleting asks first.
- On **Messages** nothing can be edited or deleted, and the tab says so above
  the conversation.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/opportunities/:id/comments?kind=note` | `crm:read` | The opportunity's notes, oldest first. `kind=message` for the conversation. `kind` is required. |
| `POST /api/v1/admin/crm/opportunities/:id/comments` | `crm:write` | Write one: `{ "kind": "note" \| "message", "body" }`. |
| `PATCH /api/v1/admin/crm/opportunities/:id/comments/:commentId` | `crm:write` | Edit a note: `{ "body" }`. Its author only. |
| `DELETE /api/v1/admin/crm/opportunities/:id/comments/:commentId` | `crm:write` | Delete a note. Its author only. |

Editing or deleting somebody else's note answers 403; doing either to a message
answers 409 `CRM_MESSAGE_IMMUTABLE`, whoever asks.

## Attachments

A brief, a drawing, a signed offer — files can be attached to an opportunity.

The file itself is kept in the **media library**. It is uploaded there first,
and the opportunity then holds a link to it. Two things follow.

**An attachment is a private file.** A file the media library holds as public
has an address anybody can open, so a public file is refused as an attachment.
The media library stores an upload as public unless told otherwise: a file
meant for an opportunity is uploaded with `visibility: "private"`.

**A file that is attached cannot be deleted from the media library.** The
library refuses, and names the opportunity by its number. Remove the attachment
first. This holds while the CRM module is switched off, too — the attachments
are still there, and so is the protection.

Anybody who may read an opportunity may download its attachments; no
permission of the media library is needed. Each attachment in the list carries
a download link that is valid for a few minutes — read the list again for a
fresh one.

In the Admin UI an opportunity has an **Attachments** tab: a list of the files
with each one's name, size, who attached it and when.

- **Add a file** uploads a file to the media library as a private file and
  attaches it. Uploading uses the media library's own upload, so the role needs
  `assets.write` as well as `crm:write`; a role without it sees a sentence
  saying so instead of the button.
- The download button prepares a fresh link at the moment it is pressed and
  opens the file in a new tab. A file that has gone missing from the media
  library says so and opens nothing.
- The bin removes the attachment, after a confirmation. The file stays in the
  media library.

Somebody who may only read sees the list and the download buttons.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/opportunities/:id/attachments` | `crm:read` | The attachments, oldest first: file name, type, size, who attached it, and `url`. |
| `POST /api/v1/admin/crm/opportunities/:id/attachments` | `crm:write` | Attach a file of the media library: `{ "assetId" }`. |
| `DELETE /api/v1/admin/crm/opportunities/:id/attachments/:attachmentId` | `crm:write` | Remove the attachment. The file stays in the media library. |

Attaching a file the opportunity already has changes nothing and answers the
existing attachment. A file that is not in the media library — or that is
attached to an opportunity the person asking may not see — is refused as one
that does not exist. If a file has gone missing from the media library, its
attachment is still listed, under the name it had, with no link.

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
| `crm:read` | View sales opportunities, the board, the status workflow and the tag list; read an opportunity's notes and messages and download its attachments. |
| `crm:write` | Create and edit opportunities, move them through the workflow, assign them, tag them, link and unlink orders, retry or dismiss a refused order change, write notes and messages, add and remove attachments (uploading a new file also needs the media library's `assets.write`). |
| `crm:configure` | Change the workflow — statuses, transitions and order-status mappings in both directions — manage the tag list, and delete an opportunity. |

A role that holds `crm:read` should also hold `orders:read`: an opportunity
shows the orders linked to it, and those are read from the Orders module.
`crm:write` and `crm:configure` each build on `crm:read`.

**Nothing else is needed.** The fields that choose an organization, a sales
channel, an assignee or a contact person — in the filters of the list and the
board, and on the forms — read CRM's own lookups, so a sales representative
does not need permission to browse customers, sales channels or administrators
to work an opportunity. What a lookup offers is narrowed to the organizations
the person may see, and is no more than a name to choose by.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/lookups/organizations?q=…` | `crm:read` | Organizations the caller may see, by name: `id`, `name`. `id=…` answers one. |
| `GET /api/v1/admin/crm/lookups/sales-channels` | `crm:read` | Every sales channel: `id`, `code`, `name` per language, `active`, `systemDefault`, and the currencies it sells in. |
| `GET /api/v1/admin/crm/lookups/assignees?q=…` | `crm:read` | Active administrators, by name: `id`, `name`. |
| `GET /api/v1/admin/crm/lookups/contacts?organizationId=…&q=…` | `crm:write` | Members of one organization the caller may see: `id`, `name`, `email`. |

The currencies offered when an opportunity is created are the ones the active
sales channels sell in.

No role receives a CRM permission automatically. Grant them on the
**Roles** screen.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `crm.enabled` | on | The switch described above. |
| `crm.auto_create_from_orders` | off | *Coming.* Create an opportunity for every newly placed order. |
| `crm.auto_create_from_quote_requests` | off | *Coming.* Create an opportunity for every newly submitted quote request. |

## Coming

- Linking quote requests, and a value computed from the linked documents.
- Creating an opportunity automatically for a new order or quote request.
- A change history for every opportunity.
- Analytics: handling time, time in each status, results by sales
  representative.

## Custom fields

An opportunity can carry fields of your own — "Lead source", "Competitor",
"Decision date" — defined without a deployment.

**Defining them.** Open **Custom fields** in the Admin UI and choose
**Opportunity** as the record type. A field has a key, a label per language, a
type (text, number, yes/no, date, one of a list, several of a list) and may be
required. This is the platform's own custom-fields screen; opportunities are
one more record type on it, beside orders, organizations, customers and quote
requests.

**Filling them in.** The fields appear on the form that creates an opportunity
and in a **Custom fields** section on the opportunity's *Overview*, labelled in
your language. On the opportunity they have their own **Save custom fields**
button; on the create form they are saved with the opportunity.

- A value that breaks its field's definition — a required field left empty, an
  option that is not on the list, text where a number is expected — is refused,
  and the message is shown at that field. Nothing is saved.
- A required field is asked for when an opportunity is created by hand, and
  whenever the custom fields are saved. Editing something else on an
  opportunity — its title, its value, its status — never asks for it, so a
  field made required today does not block work on yesterday's opportunities.
- An opportunity created automatically has no custom values until somebody
  fills them in.
- When a field is deleted, its values stop being shown.

**Who sees them.** Whoever can see the opportunity sees its custom values, and
nobody else: they are part of the opportunity. Showing the fields also needs
the `custom_fields:read` permission, because the list of fields is read from
the Custom fields module — a role that holds `crm:read` should hold it too.
Somebody without it sees no custom fields section; if a required field then
refuses their new opportunity, the form names the field in its error message.

**For integrators.** `POST` and `PATCH /api/v1/admin/crm/opportunities` accept
an optional `customFieldValues` object keyed by field key, and the opportunity
answers with `customFieldValues`. On `PATCH`, the object names the fields it
changes; leaving it out leaves every value as it is. A refused value answers
`422 CUSTOM_FIELD_VALUE_INVALID` with one `{ path, issue }` per field. The
write is part of the opportunity's own audit entry — there is no separate one.

**With CRM switched off**, *Opportunity* is not offered on the Custom fields
screen and its field definitions cannot be created, changed or deleted (`409`).
Nothing is removed: switching CRM back on restores the definitions and every
stored value.

## Opportunities on the organization's screen

An organization's screen ends with an **Open opportunities** panel: the
opportunities being worked with that organization that are not yet won or lost,
newest first, each with its number and title (a link to the opportunity), its
status and its value. **New opportunity** opens the create form with the
organization already chosen.

- The panel is shown to whoever holds `crm:read`; **New opportunity** needs
  `crm:write`.
- It lists the ten newest and, when there are more, links to the opportunity
  list.
- Somebody confined to certain organizations sees the panel only on those
  organizations' screens, like every other opportunity list.
- With CRM switched off the organization's screen shows nothing of it — no
  panel, no heading, no request.

The dashboard's recent activity names an opportunity by its title and links to
its screen. With CRM switched off, and for somebody who may not see that
opportunity, the entry stays and carries no title and no link.

## Reading and moving an opportunity from another module

For developers. Another module, or a deployment's overlay, works with
opportunities through two published ports and never through CRM's tables or
classes. Both types are exported by `@endora-commerce/contracts`.

| Container name | Type | What it does |
| --- | --- | --- |
| `opportunityReadPort` | `OpportunityReadPort` | `findById(id)`, `findByDocument(kind, documentId)` and `listOpenForOrganization(organizationId)`. Each answers plain `OpportunityRecord` values — id, number, title, organization, status code and kind, assignee, value, currency, dates — or `null` / an empty list. |
| `opportunityTransitionPort` | `OpportunityTransitionPort` | `applyStatus({ opportunityId, to, actor, reason? })` moves an opportunity through the configured workflow, guards and events included, and answers what happened as a value. |

```ts
import type { OpportunityTransitionPort } from '@endora-commerce/contracts';
import { lazyPort } from '@endora-commerce/platform/kernel';

const opportunities = lazyPort<OpportunityTransitionPort>(ctx, 'opportunityTransitionPort');

const outcome = await opportunities.applyStatus({
  opportunityId,
  to: 'won',
  actor: { kind: 'system' },
  reason: 'Contract signed in the ERP',
});
if (!outcome.applied && outcome.reason !== 'already_there') {
  // 'not_found' | 'unknown_status' | 'not_permitted' | 'vetoed', with `detail`
}
```

- **A refusal is a value, not an exception.** `applied: true` carries `from`
  and `to`. `already_there` means the opportunity is where you wanted it and
  nothing was written. `not_found` also covers an opportunity outside the
  caller's organizations. `not_permitted` means the workflow has no such
  transition; `vetoed` means a guard refused, and `detail` is the guard's own
  sentence.
- **Call it after your own commit**, never inside your transaction: the port
  opens its own.
- **Reads and moves run under the caller's tenant scope.** A caller confined to
  some organizations cannot read or move an opportunity of another.
- **Declare the edge in your manifest.** A module that cannot work without CRM
  lists `crm` in `dependencies`. One that can lists it in
  `nonBindingDependencies` with `kind: 'degrades-without'`, the port's name and
  a `whenAbsent` sentence an operator will read before switching CRM off.
- **With CRM switched off both ports fail closed**: resolving either throws
  `ModuleDisabledError` (HTTP `503 MODULE_DISABLED`). Do not wrap the call in a
  bare `catch` — a consumer that degrades asks
  `effectiveState.isPresent('crm')` first.

To react to a status change rather than cause one, subscribe to the events or
register a guard, as *Adding your own logic to a status change* describes.

## Demo data

CRM ships no demo data: `endora demo seed` creates no opportunity. An
opportunity always belongs to an organization, and a demo opportunity linked to
an order needs a demo order as well — rows of other modules, which a module's
own demo data may not create or read. A demo pipeline is therefore a step of
the instance's demo composition rather than of this module, and is not part of
this release. The default workflow is always installed, so a board has its
columns from the first start.
