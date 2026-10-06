---
title: crm
description: Sales opportunities with a configurable status workflow that linked orders follow
---

# `crm`

The CRM module keeps track of **sales opportunities**: a deal a sales
representative is working with one customer organization, from the first
contact to the moment it is won or lost.

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
| An opportunity | a row of the list (`/crm/opportunities/:id`) | `crm:read` | Its status and the moves the workflow allows from it, its value, the orders and quote requests linked to it, and what became of those orders after each move; on further tabs its notes, messages, attachments and **change history**. |
| Board | **CRM → Board** (`/crm/board`) | `crm:read` | The same opportunities as cards, in a column per status. A holder of `crm:write` moves a card to another status. |
| Analytics | **CRM → Analytics** (`/crm/analytics`) | `crm:analytics` | Five figures over a range of days: handling time, time in each status, the most effective sales reps, the most valuable opportunities and the average value. |
| Tags | **CRM → Tags** (`/crm/tags`) | `crm:configure` | The tag list: add, rename, recolour and delete the labels opportunities may carry. |
| Workflow | **CRM → Workflow** (`/crm/workflow`) | `crm:configure` | The statuses, the transitions between them, the order status each opportunity status sets, and the opportunity status each order status leads to. |

The everyday screens are also in the command palette (`⌘K` / `Ctrl+K`):
**Sales opportunities**, **New sales opportunity**, **Opportunity board** and
**CRM analytics**.

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
| `PATCH /api/v1/admin/crm/opportunities/:id` | `crm:write` | Edit it. Send the version you read in `If-Match`; a stale one is refused with `409`, and a header that is not the version — quoted as the `ETag` gives it, or bare — with `400`. |
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
| `POST /api/v1/admin/crm/opportunities/:id/links` | `crm:write` and `orders:read` | Link an order. |
| `PATCH /api/v1/admin/crm/opportunities/:id/links/:linkId` | `crm:write` and `orders:read` | Switch status following on or off. |
| `DELETE /api/v1/admin/crm/opportunities/:id/links/:linkId` | `crm:write` | Unlink. |

**An order is the Orders module's to show.** Linking one, and deciding whether
it follows, needs `orders:read` as well as `crm:write` and answers `403`
without it; unlinking needs `crm:write` only. Somebody who reads an opportunity
without `orders:read` sees that an order is linked and nothing of it — it is
listed as **unavailable**, with no number, status or total, and an order change
that was refused is shown without the order's number. The Admin UI offers the
order picker and the following switch to a holder of both permissions and says
so to anybody else.

Moving an opportunity moves the orders that follow it **whoever moves it**:
which order status a move asks for was set up by somebody holding
`crm:configure`, so the person moving the opportunity does not need
`orders:write`.

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
active administrator who can reach the opportunity's organization may be the
assignee.

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

Somebody who is not an active administrator, or who cannot reach the
opportunity's organization, cannot be assigned: the request is refused with
`CRM_ASSIGNEE_INVALID`. Editing an opportunity may change its
assignee too, under the same rule.

A person is told when an opportunity becomes theirs — on the notification bell
of the Admin UI, with a link to the opportunity. The entry names the
opportunity by its number and never by its title, and is not written for
somebody who can no longer reach the opportunity's organization. The same
holds for an opportunity created automatically. Nobody is told about taking an
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
deleted note is no longer listed. The opportunity's change history records
that a note was written, edited or deleted, by whom and how long it was —
never what it said.

A **message** is part of a conversation between the people working the
opportunity. Messages are listed in the order they were sent, and **a message
cannot be changed or deleted once it is sent** — not by its author, not by
anybody: the attempt is refused with `CRM_MESSAGE_IMMUTABLE`. A message tells
the opportunity's assignee and everybody who has already written in that
conversation, except the person who sent it, on the notification bell of the
Admin UI with a link to the opportunity. The entry names the opportunity by
its number and carries nothing of the message, and is not written for somebody
who can no longer reach the opportunity's organization. While the **Admin
notifications** module is switched off, a message is stored all the same and
nobody is told.

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

**Adding a file needs `crm:write` and nothing else.** The file is sent to the
CRM's own upload, which stores it in the **media library** as a private file
and attaches it to the opportunity in the same step. No permission of the media
library is involved, so a sales rep who cannot open the media library can still
add a file to the opportunities they work.

The file itself is kept in the media library, and the opportunity holds a link
to it. Three things follow.

**What a file may be is the media library's decision.** The allowed file types
and the size limit set for the media library apply to an attachment exactly as
they do to any other upload, and a file the library refuses is refused here
with the library's own answer. On top of that an attachment may be at most
**25 MB**, whatever the library allows.

**An attachment is a private file.** A file the media library holds as public
has an address anybody can open, so a file uploaded through the CRM is always
stored as private, and a public file is refused as an attachment.

**A file that is attached cannot be deleted from the media library.** The
library refuses, and names the opportunity by its number. Remove the attachment
first. This holds while the CRM module is switched off, too — the attachments
are still there, and so is the protection.

Anybody who may read an opportunity may download its attachments; no
permission of the media library is needed. Each attachment in the list carries
a download link that is valid for a few minutes — read the list again for a
fresh one. The link downloads the file; it is never opened as a page.

**A file a browser would run is not accepted as an attachment**: HTML, SVG,
XML and JavaScript, judged by the file's name and by its type — either is
enough. The upload and attaching by `assetId` both answer `415
ASSET_UPLOAD_TYPE_NOT_ALLOWED`, and nothing is stored.

In the Admin UI an opportunity has an **Attachments** tab: a list of the files
with each one's name, size, who attached it and when.

- **Add a file** — or dropping a file onto the dashed area — uploads one file
  and attaches it. It is offered to everybody who holds `crm:write`. A file
  over 25 MB is refused before it is sent; a file the media library does not
  accept is refused with the library's reason.
- The download button prepares a fresh link at the moment it is pressed and
  downloads the file. A file that has gone missing from the media
  library says so and opens nothing.
- The bin removes the attachment, after a confirmation. The file stays in the
  media library.

Somebody who may only read sees the list and the download buttons.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/opportunities/:id/attachments` | `crm:read` | The attachments, oldest first: file name, type, size, who attached it, and `url`. |
| `POST /api/v1/admin/crm/opportunities/:id/attachments/upload` | `crm:write` | Upload a file and attach it: `multipart/form-data` with one `file` part. |
| `POST /api/v1/admin/crm/opportunities/:id/attachments` | `crm:write` | Attach a file that is already in the media library as a private file: `{ "assetId" }`. |
| `DELETE /api/v1/admin/crm/opportunities/:id/attachments/:attachmentId` | `crm:write` | Remove the attachment. The file stays in the media library. |

The upload answers the new attachment. It answers 413 `CRM_ATTACHMENT_TOO_LARGE`
for a file over 25 MB, and passes on the media library's own refusals — 413
`ASSET_UPLOAD_TOO_LARGE`, 415 `ASSET_UPLOAD_TYPE_NOT_ALLOWED` — unchanged. An
opportunity the person asking may not see answers 404 before anything is
stored, and a file that was stored but could not be attached is removed from
the media library again.

Attaching by `assetId` is for an integration that has already put a file in the
media library; the Admin UI does not use it. Attaching a file the opportunity
already has changes nothing and answers the existing attachment. A file that is
not in the media library — or that is attached to an opportunity the person
asking may not see — is refused as one that does not exist. If a file has gone
missing from the media library, its attachment is still listed, under the name
it had, with no link.

## Analytics

**CRM → Analytics** shows how the opportunities of a chosen range of days
went. It opens for a role that holds `crm:analytics`.

Choose the range — this month, last month, the last 90 days, this year, or two
dates of your own — and, if you wish, one sales channel and one sales rep.
Every figure is recomputed at once. A manager restricted to a set of
organizations gets figures over those organizations only.

| Figure | What it is | Which opportunities count |
| --- | --- | --- |
| Average handling time | The time from creating an opportunity to closing it, averaged. Given for every closed opportunity together, and for won and lost apart. | Those closed in the range. An opportunity that was reopened is not counted until it is closed again. |
| Average time in status | How long an opportunity stays in a status: from the change that put it there to its next change, averaged over every time the status was entered. An opportunity that is still in the status is counted up to now. Choose the statuses to show, or see them all. | Every entry into the status that happened in the range. |
| Most effective sales reps | How many opportunities each sales rep closed as won, and what they were worth — for the whole range, and month by month. The sales rep is the person the opportunity is assigned to. | Those closed as won in the range and assigned to somebody. |
| Most valuable opportunities | The ten opportunities with the highest value, each a link to the opportunity. Choose whether the range goes by the creation date or by the closing date. | Those created — or closed — in the range that have a value. |
| Average opportunity value | The mean value of an opportunity. | Those created in the range that have a value. |

**Amounts in different currencies are never added together.** The platform has
no exchange rate, so every figure about value is given per currency: an average
for each currency, a list of the most valuable opportunities for each currency,
and each sales rep's won value for each currency.

The **value** of an opportunity is the one shown on it: the amount entered by
hand, or — when the opportunity is set to be computed — the amount computed
from its linked documents.

**Days and months are counted in UTC**, and a range includes both of its dates
in full.

Time in status and the ranking of sales reps are drawn as charts. Each chart
has a table under it with the same numbers, so nothing is said by a chart
alone.

The figures are computed at the moment the screen asks for them; nothing is
stored in advance.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/analytics/handling-time` | `crm:analytics` | `averageSeconds` and `closedCount`, and the same pair for `won` and for `lost`. |
| `GET /api/v1/admin/crm/analytics/time-in-status` | `crm:analytics` | A row per status: `statusCode`, `averageSeconds`, `sampleCount`. Repeat `statusCode=` to choose statuses; without it, every status of the workflow in its order. |
| `GET /api/v1/admin/crm/analytics/rep-effectiveness` | `crm:analytics` | A row per calendar month and sales rep: `month` (`YYYY-MM`), `adminUser`, `wonCount`, and `wonValue` per currency. |
| `GET /api/v1/admin/crm/analytics/top-opportunities` | `crm:analytics` | The opportunities with the highest value: `limit` (10 unless given, 100 at most) **for each currency**, ordered by currency and then highest first. `basis=created` unless `basis=closed`. |
| `GET /api/v1/admin/crm/analytics/average-value` | `crm:analytics` | A row per currency: `currency`, `average`, `count`. |

Each takes `from` and `to` (`YYYY-MM-DD`) and, optionally, `salesChannelId` and
`assignedAdminUserId`. A range that ends before it begins answers 422. A
figure with nothing to average answers `null`, not zero.

## Quote requests and a computed value

### Linking quote requests

A quote request is linked to an opportunity the way an order is, through the
same endpoint with `"documentKind": "quote_request"`. It must belong to the
opportunity's organization, and it belongs to at most one opportunity. An
opportunity can hold several quote requests and several orders.

A linked quote request is listed with its number, its status and its value.
**A quote request is the Quote Requests module's to show**: linking one, and
being offered one to link, needs `rfqs:handle` — the permission that module
reads a request with — as well as `crm:write`, and answers `403` without it.
Somebody who reads an opportunity without `rfqs:handle` sees that a quote
request is linked and nothing of it; it is listed as unavailable. Unlinking
needs `crm:write` only.
The "follow the opportunity's status" switch means nothing for one: a quote
request keeps its own status.

When an order is placed from a linked quote request, the order is linked to
the same opportunity by itself (`linkSource: "quote_conversion"`). This relies
on the order recording which quote request it came from.

### The value of an opportunity

An opportunity's value is either **typed in** or **computed** from its linked
documents — chosen per opportunity (`valueMode`: `manual` or `computed`). The
typed figure is kept when the mode is switched to computed, and is back when it
is switched to manual again.

A computed value is the sum of:

- every linked **order** whose status is a counting order status, at the
  order's **total** — the gross amount the customer pays: goods, tax, delivery
  and any payment surcharge, less discounts;
- every linked **quote request** whose status is a counting quote request
  status, at the **sum of quantity × unit price** over its lines. The unit
  price is the agreed price, or the price the customer asked for while none has
  been agreed. Quote prices are **net of tax** — this is the figure the quote
  request's own screen shows as its net total.

The two are not on the same basis, and neither is converted: each document
counts at the figure its own screen shows.

**Counted once.** An order placed from a linked quote request and that quote
request are one piece of business. While the order counts, the quote request is
left out.

**One currency.** An opportunity has one currency and nothing is converted. A
document in another currency that would otherwise count is left out, and the
opportunity names it: `excludedDocuments` on the opportunity lists each one as
`{ kind, id, reason: "currency_mismatch" }`. A quote request with lines in
several currencies counts the lines in the opportunity's currency and is named
as well.

The value follows the documents: it is recalculated when a document is linked
or unlinked, when a linked order changes status, when a linked quote request is
modified, approved, canceled or expires, and when the mode becomes computed.
A recalculation is not an entry in the opportunity's history.

### Which statuses count

Which statuses make a document count is part of the workflow configuration,
and **nothing counts until it is set**: a computed value is 0 with an empty
configuration.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `PUT /api/v1/admin/crm/value-counting-statuses` | `crm:configure` | Replace the set: `{ "order": ["paid", "completed"], "quoteRequest": ["Approved"] }`. |

`order` holds order status codes; `quoteRequest` holds any of `Created from
admin`, `Pending`, `Canceled`, `Approved`, `Completed`, `Expired`. The current
set is `valueCountingStatuses` on `GET /api/v1/admin/crm/workflow`.

The endpoint answers **202**: the set is saved, and every computed opportunity
is then recalculated in the background (queue `crm-value-recalculation`). Until
that has run, opportunities show the figures of the previous configuration.

### With the Quote Requests module switched off

CRM does not need the Quote Requests module. While it is switched off:

- opportunities, their orders and everything else keep working;
- a linked quote request is still listed, as **unavailable** — no number, no
  status, no value;
- it adds nothing to a computed value;
- linking a quote request answers `503 MODULE_DISABLED`; an existing link can
  still be removed.

Nothing is lost: switched back on, the links show their documents again. A
computed value picks the quote requests up again at its next recalculation.

### In the Admin UI

On an opportunity's **Overview**:

- **Linked quote requests** lists each one with its number, its status and its
  net value, next to *Linked orders*. A holder of `crm:write` searches the
  organization's quote requests by number and links one, or unlinks one. The
  search offers the open quote requests; a closed one is found by typing its
  full number. Linking does not need the permission to handle quotes.
- **Value** shows the figure and whether it is *entered by hand* or a *computed
  value*, and one button switches between the two. For a computed value it
  lists every document that was **left out**, with the reason, and reminds you
  that your own estimate is kept.

On **CRM → Workflow**, *Statuses that count towards a computed value* is two
lists of checkboxes — order statuses and quote request statuses — saved
together. *This and every later status* ticks an order status and all that
follow it. After saving, the screen says that the values are being recalculated
in the background: until that has finished, lists and the board still show the
figures of the previous settings.

With the Quote Requests module switched off, the quote request list of an
opportunity that has none disappears, one that has some shows them as
unavailable and says why, and the workflow screen offers order statuses only.

## Opportunities created automatically

Two settings make the CRM open an opportunity by itself. Both are **off** by
default.

| Setting | When it is on |
| --- | --- |
| `crm.auto_create_from_orders` | Every order placed from then on gets an opportunity of its own. The setting can differ per sales channel; the order's channel decides. |
| `crm.auto_create_from_quote_requests` | Every quote request created from then on — submitted by a customer or prepared by an administrator — gets an opportunity of its own. Needs the Quote Requests module to be on. |

An opportunity created this way:

- belongs to the document's organization and, for an order, to the order's
  sales channel;
- starts in the workflow's start status;
- is assigned by the default rule — the organization's longest-standing active
  sales representative, who is notified — or to nobody when the organization
  has none;
- is titled with the document's number and the organization's name;
- is linked to the document, and its value is **computed** from it (see *Quote
  requests and a computed value*), in the document's currency;
- records where it came from: `source` is `order` or `quote_request`.

What is **not** created:

- nothing for a document that is already linked to an opportunity;
- nothing for an order placed from a quote request that is linked to an
  opportunity — the order joins that opportunity instead, whatever the settings
  say;
- nothing for documents that existed before the setting was switched on;
- nothing while the CRM module is switched off, and nothing afterwards for the
  documents placed in the meantime;
- nothing for an order or a quote request created from within an opportunity:
  it is linked to that opportunity instead, whatever the settings say (see
  *Creating an order or a quote request from an opportunity*).

An order or a quote request an administrator creates on a customer's behalf,
from the document's own screen, is a document like any other and gets its
opportunity.

Each document gets at most one opportunity, however many times its placement
is announced.

An opportunity for a quote request has no sales channel, and its setting is
read for the whole platform rather than per channel: the Quote Requests module
does not publish the channel a request was submitted on.

## Creating an order or a quote request from an opportunity

On the **Overview** of an opportunity, the *Linked orders* section has a
**Create order** button and the *Linked quote requests* section a **Create
quote request** button. Each opens the platform's own create screen — the one
under **Orders** or **Quote requests** — already narrowed to the opportunity's
organization: the customer search offers that organization's people, the
opportunity's contact person arrives chosen, and so does its sales channel on
an order.

Fill the screen in as usual and save. You are brought back to the opportunity,
which says that the new document is being linked and then that it is; the
document is in its list from then on, marked in the change history as *created
from the opportunity*. An order created this way follows the opportunity's
status like any linked order, and both kinds count towards a computed value.

What to expect:

- **No second opportunity.** With automatic creation switched on, a document
  created from an opportunity is linked to that opportunity and gets none of
  its own.
- **The same organization only.** The create screen lets you pick any customer
  you may see. If you save the document for a customer of another organization
  it is created, but it is **not** linked: the opportunity says so on your
  return and offers a link to the document. Nothing about the opportunity is
  changed.
- **Who sees the buttons.** *Create order* needs `crm:write` and
  `orders:write`; *Create quote request* needs `crm:write` and `rfqs:handle`.
  The create screens also search customers, which needs `customers:read`.
- **With the Quote Requests module switched off** there is no *Create quote
  request* button. *Create order* is unaffected.
- **With the CRM module switched off** the create screens work exactly as they
  always have, and nothing is linked — then or later.

For integrators: the link is made by the module's subscribers of
`order.created.v1` and `rfq.created_by_admin.v1`, from the `origin` those
events carry — `{ type: 'crm_opportunity', id: <opportunity id> }`. The Orders
and Quote Requests modules hand that value on without reading it. The CRM
module links only when the opportunity exists and belongs to the same
organization as the document, and — where the event names the administrator
who created the document, as the quote request event does — when that
administrator can reach the opportunity's organization; otherwise it writes a
warning to the log and treats the document as one created without an origin.
An event delivered twice links once. No endpoint of the CRM module is involved,
and sending an `origin` yourself, in a request to either create endpoint, has
the same effect.

## Change history

Every opportunity keeps a history of what was done to it, newest first: its
creation, each edit, each status change, every order or quote request linked or
unlinked, each assignment, tag change, note, message and attachment.

Each entry says **when**, **what** (`action`), **who** (`actor`) and the state
**before** and **after**:

- `actor.kind` is `admin` with the person's id and name, or `system` — nobody
  did it by hand: an order moved the opportunity, or the opportunity was created
  automatically;
- a status change carries `before.status` and `after.status`, what caused it
  (`after.cause`: `manual`, `order_status` or `system`), the order that caused
  it when one did (`after.causeOrderId`), and the reason somebody typed;
- an edit carries the fields as they were and as they are.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/opportunities/:id/history` | `crm:read` | The history, newest first. `limit` (default 50, at most 200) and `cursor` page through it. |

The history is the platform's audit trail of that opportunity, so it cannot
disagree with what happened — and **anybody who may read the opportunity may
read its history**. The permission that opens the platform-wide audit log is
not needed.

Three things to know:

- A note or a message is in the history as the fact that it was written,
  edited or deleted — by whom, and how long it was. Its text is not: that is
  read on the *Notes* and *Messages* tabs.
- Recalculating a computed value is not an entry: the change that caused it —
  a link, an order's status — is.
- The history reaches back 500 entries.

On the platform-wide **Audit log** screen the same entries appear among
everybody else's, as the same sentences.

In the Admin UI the history is the **Change history** tab of an opportunity.
Each entry is a sentence — *Opportunity status changed*, *Note added* — with
who did it and when. A status change shows the two statuses by name; when an
order caused it, the entry names that order and links to it. An edit lists the
fields that changed, as they were and as they are. *Show earlier changes* reads
the next page.

## References to products and orders

The description of an opportunity, a note and a message can mention a
**product** or an **order**. A mention is a token in the text:

```text
[[product:<product id>]]
[[order:<order id>]]
```

The text is stored and returned exactly as it was written — plain text; nothing
in it is treated as markup. Beside every such text the API returns
`references`: one entry per product or order mentioned, in the order they
appear, each once.

```json
{
  "type": "product",
  "id": "5d0c…",
  "available": true,
  "label": "Pallet wrap 500 mm",
  "url": "/catalog/products/5d0c…"
}
```

- `label` is the product's **current** name, in the reader's language, or the
  order's number — looked up each time the text is read, so a renamed product
  shows its new name.
- `url` is where the mention leads in the Admin UI.
- A product that no longer exists, and an order of an organization the reader
  may not see, come back with `"available": false` and **no label and no
  link**. The mention stays in the text; nothing about its target is shown.

A token that is not well-formed — an unknown type, something that is not an id
— is simply text.

`references` is on the opportunity (for its `description`) and on every note
and message (for its `body`). There is no separate endpoint.

In the Admin UI the description field and the note and message fields carry
two buttons, **Insert product** and **Insert order**. Each opens a search;
choosing a result writes the token where the cursor was. Once saved, the text
shows the product's name or the order's number as a link in its place, and
*Product unavailable* / *Order unavailable* for a target that is gone or that
you may not see. A name is shown only to somebody who could open the target
itself: an order's number needs `orders:read`, a product's name
`catalog:read`.

The two searches are the catalogue's and the Orders module's own, so *Insert
product* is offered to a role that also holds `catalog:read` and *Insert order*
to one that holds `orders:read`; orders are offered for the opportunity's
organization only. A token typed or pasted by hand is saved without either,
and reads as unavailable to whoever lacks the permission.

## Telling other systems: webhooks

Three things that happen to an opportunity can be sent to another system
through the platform's **webhooks**: when it is created, when its status
changes, and when it is closed. On the *Webhooks* screen they appear among the
event types a subscription can choose, and they are delivered like every other
webhook — signed, retried, listed among the deliveries.

| Event type | Sent when |
| --- | --- |
| `crm.opportunity.created.v1` | an opportunity is created — by hand or automatically |
| `crm.opportunity.status_changed.v1` | an opportunity moves to another status, whatever moved it |
| `crm.opportunity.closed.v1` | an opportunity enters a status that closes it, won or lost |

Closing as won and closing as lost are **one** event: `outcome` says which. A
move into a closing status sends both `status_changed` and `closed`.

**What is sent is the event itself**, exactly these fields and no other:

```json
{
  "eventId": "8f0c2c2e-3f0b-4d0a-9a55-0d5e6b7a1c11",
  "occurredAt": "2026-10-05T12:00:00.000Z",
  "opportunityId": "5d0c7c1e-6a0f-4f55-8a53-0f3f7cbe0a01",
  "number": "OPP-000123",
  "organizationId": "6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02",
  "source": "manual"
}
```

`crm.opportunity.created.v1` — `source` is `manual`, `order` or `quote_request`.

```json
{
  "eventId": "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  "occurredAt": "2026-10-05T12:05:00.000Z",
  "opportunityId": "5d0c7c1e-6a0f-4f55-8a53-0f3f7cbe0a01",
  "number": "OPP-000123",
  "organizationId": "6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02",
  "salesChannelId": null,
  "from": "negotiation",
  "to": "won",
  "fromKind": "open",
  "toKind": "won",
  "actor": { "kind": "admin", "adminUserId": "0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01" },
  "cause": "manual",
  "reason": "Contract signed"
}
```

`crm.opportunity.status_changed.v1` — `actor.kind` is `admin` (with
`adminUserId`) or `system`; `cause` is `manual`, `order_status` or `system`, and
when an order caused the move `causeOrderId` names it. `reason` is the short
text somebody typed for that move, or `null`.

```json
{
  "eventId": "c3a1f0de-52c7-4d0c-8a44-2f7e7a9f3b10",
  "occurredAt": "2026-10-05T12:05:00.000Z",
  "opportunityId": "5d0c7c1e-6a0f-4f55-8a53-0f3f7cbe0a01",
  "organizationId": "6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02",
  "outcome": "won",
  "value": "1500.00",
  "currency": "PLN"
}
```

`crm.opportunity.closed.v1` — `outcome` is `won` or `lost`; `value` is the
opportunity's value when it closed, or `null` when it has none.

Things to rely on:

- **No free text of an opportunity is ever sent**: no title, no description, no
  note, no message. `reason` is the only text, and it is what was typed for one
  status change.
- **`organizationId` is always there**, so a subscription bound to one
  organization receives that organization's opportunities only.
- **The version is in the name.** A `.v1` event keeps its fields. A field may
  be added to it; if one ever has to be removed or renamed, that is a new
  `.v2` event, offered beside the old one.

With the Webhooks module switched off, opportunities work as ever and nothing
is sent — and what happened meanwhile is not sent later. With the CRM module
switched off, its three event types are not offered; a subscription that names
one is kept and simply receives nothing until CRM is back.

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

## The opportunity on the order's screen

An order's screen ends with a **Linked opportunity** panel, whichever tab is
open.

- **An order linked to an opportunity** shows the opportunity's number and
  title (a link to it), its status, who it is assigned to and its value.
- **An order linked to none** says so and offers two actions to whoever holds
  `crm:write`:
  - **Link to an opportunity** lists the open opportunities of the order's
    organization (the hundred newest); choose one and confirm. An order
    belongs to at most one opportunity, and only to one of its own
    organization — a refusal is shown in the panel.
  - **Create opportunity** opens the create form with the order's organization
    chosen. When the opportunity is saved the order is linked to it and the
    opportunity opens. If the link is refused, the opportunity has still been
    created: the form says so and links to it, and the order can be linked from
    the opportunity's own screen.
- The panel is shown to whoever holds `crm:read`. Without it, and with CRM
  switched off, the order's screen is exactly as it is without the module — no
  panel, no heading, no empty space, no request.

Quote requests get the same panel once they can be linked to an opportunity.

For integrators: `GET /api/v1/admin/crm/documents/order/{orderId}/opportunity`
(`crm:read` and `orders:read`) answers `{ "data": <the opportunity's summary> }`, or
`{ "data": null }` for an order linked to none. An order that does not exist or
is not the caller's to see answers `404 CRM_DOCUMENT_NOT_FOUND` — the same
answer for both, whether or not it is linked. A kind other than a document
kind answers `422`. The create form accepts `linkDocumentKind=order` and
`linkDocumentId=<order id>` beside `organizationId` in its address.

For module authors: the panel is CRM's contribution to the `order.detail.after`
admin zone, which the Orders module mounts and which any module may contribute
to. Orders does not import CRM and declares no dependency on it.

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
| `crm:read` | View sales opportunities, the board, the status workflow and the tag list; read an opportunity's change history, its notes and messages, and download its attachments. |
| `crm:write` | Create and edit opportunities, move them through the workflow, assign them, tag them, link and unlink orders and quote requests, choose whether the value is typed in or computed, retry or dismiss a refused order change, write notes and messages, upload, add and remove attachments. |
| `crm:configure` | Change the workflow — statuses, transitions and order-status mappings in both directions, and which statuses count towards a computed value — manage the tag list, and delete an opportunity. |
| `crm:analytics` | Open the Analytics screen and read its five figures. |

A role that holds `crm:read` should also hold `orders:read` and
`custom_fields:read`: an opportunity shows the orders linked to it, which are
read from the Orders module, and its custom fields, whose definitions are read
from the Custom Fields module. The **Roles** screen suggests both.
`crm:write`, `crm:configure` and `crm:analytics` each build on `crm:read`:
the Analytics screen names statuses and offers its sales channel and sales rep
filters from what `crm:read` reads.

**What another module owns is shown to somebody who may read it there.** An
opportunity opens with `crm:read` alone, and then lists a linked order or
quote request as unavailable and names no order or product its texts mention.
`orders:read` shows a linked or mentioned order and allows linking one;
`rfqs:handle` does the same for a quote request; `catalog:read` names a
mentioned product. A document a computed value leaves out is named under the
same rule. The value itself is the opportunity's own figure and is shown to
everybody who may read the opportunity.

**Nothing else is needed to fill in a form.** The fields that choose an organization, a sales
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
| `GET /api/v1/admin/crm/lookups/quote-requests?organizationId=…&q=…` | `crm:write` and `rfqs:handle` | Quote requests of one organization the caller may see that can be linked: the open ones, and the one whose number is typed in full. `id`, `number`, `status`. Answers `503` while the Quote Requests module is off. |

The currencies offered when an opportunity is created are the ones the active
sales channels sell in.

No role receives a CRM permission automatically. Grant them on the
**Roles** screen.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `crm.enabled` | on | The switch described above. |
| `crm.auto_create_from_orders` | off | Every order placed from then on gets an opportunity of its own. The setting can differ per sales channel; the order's channel decides. |
| `crm.auto_create_from_quote_requests` | off | Every quote request created from then on — submitted by a customer or prepared by an administrator — gets an opportunity of its own. Needs the Quote Requests module to be on. |

## Demo data

CRM ships no demo data: `endora demo seed` creates no opportunity. An
opportunity always belongs to an organization, and a demo opportunity linked to
an order needs a demo order as well — rows of other modules, which a module's
own demo data may not create or read. A demo pipeline is therefore a step of
the instance's demo composition rather than of this module, and is not part of
this release. The default workflow is always installed, so a board has its
columns from the first start.
