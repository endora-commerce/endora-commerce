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
| An opportunity | a row of the list (`/crm/opportunities/:id`) | `crm:read` | A header, a stage bar with its current status and the moves allowed from it, back and forward, a card of its facts on the right, and tabs: *Overview*, **Links** (its orders and quote requests), **Events** (what is planned for it, with reminders), *Notes*, *Messages*, *Attachments* and **Change history**. See *The opportunity's screen*. |
| Board | **CRM → Board** (`/crm/board`) | `crm:read` | The same opportunities as cards, in a column per status. A holder of `crm:write` moves a card to another status. |
| Calendar | **CRM → Calendar** (`/crm/calendar`) | `crm:read` | The events planned on the open opportunities you may see, by month, week or day, or as a list. Every event opens its opportunity. See *The calendar*. |
| Analytics | **CRM → Analytics** (`/crm/analytics`) | `crm:analytics` | Five figures over a range of days: handling time, time in each status, the most effective sales reps, the most valuable opportunities and the average value. |
| Tags | **CRM → Tags** (`/crm/tags`) | `crm:configure` | The tag list: add, rename, recolour and delete the labels opportunities may carry. |
| Workflow | **CRM → Workflow** (`/crm/workflow`) | `crm:configure` | The statuses, the transitions between them, the order status each opportunity status sets, the opportunity status each order status leads to, the statuses that count towards a computed value, and the fields a board card shows. |

The everyday screens are also in the command palette (`⌘K` / `Ctrl+K`):
**Sales opportunities**, **New sales opportunity**, **Opportunity board**,
**CRM analytics** and **CRM calendar**.

A first walk through the module, start to finish:

1. On **Workflow**, check the statuses — which one is the start status, which
   close an opportunity as won or lost — and the arrows between them. Under
   *Order status for each opportunity status*, choose what each status should
   do to a linked order, and save.
2. On **Opportunities**, press **New opportunity**, fill in the title, the
   organization and the currency, and create it. You land on the opportunity.
3. On the **Links** tab, under *Linked orders*, search the organization's
   orders by number and link one. It follows the opportunity's status unless
   you untick that for it.
4. In the stage bar at the top, press the status to move to. Only the moves the
   workflow allows from the current status are shown, as *Back* and *Forward*.
5. Under *Order status changes*, below the bar, read what happened to each
   linked order. An
   order that could not be moved is listed with the reason and two buttons,
   **Retry** and **Dismiss**; it stays there, on every later visit, until one of
   them is pressed.

An administrator who may read but not write sees the same screens without the
controls that change anything.

## The opportunity's screen

Under its header, one opportunity is laid out in two columns: on the left what
you work with — its status, then the tabs — and on the right, beside all of it,
a card of its facts.

**The header** carries the title with its status beside it and, under it, one
quiet line: the number, the organization, who holds it — or *Unassigned* — and
the sales channel when there is one. **Edit** (`crm:write`) and **Delete**
(`crm:configure`) are on the right.

**The stage bar**, at the top of the left column, names the **current status**
and shows where the opportunity can go from it — and nothing else. A workflow
is not a straight line, so the bar does not draw one: a status your workflow
does not allow from here is not on the screen.

- **Back** lists the moves to a status that comes earlier in the order you gave
  the statuses on **CRM → Workflow**, and the moves that reopen a closed
  opportunity.
- **Forward** lists the moves to a later status, and every move that closes the
  opportunity, each marked as *won* or *lost* — whatever position a closing
  status has in your list.
- A side with no move is not shown. When the workflow allows no move at all,
  the bar says so; a closed opportunity also says how and when it closed.
- For a holder of `crm:write` **each move is a button**, and pressing it is the
  same status change, with the same rules, as anywhere else in the module. The
  optional **reason** is the field under the bar. Somebody with `crm:read`
  alone sees the same moves as plain text.
- **The bar does not claim a history, and it does not count stages.** It says
  where the opportunity is and where it can go; the *Change history* tab says
  where it has been.
- If the order of your statuses cannot be loaded, every move is still offered:
  the ones that close the opportunity under *Forward*, the others under
  *Possible moves*, with a line saying they could not be sorted.

What became of the linked orders after a move — and any change an order
refused, until it is retried or dismissed — is listed directly under the bar,
whichever tab is open.

**The tabs**, under it in the left column:

| Tab | What is on it |
| --- | --- |
| **Overview** | The description, the custom fields, and — after **Edit** — the edit form. |
| **Links** | *Linked orders* and *Linked quote requests*: link, unlink, the *follow the opportunity's status* switch, **Create order** and **Create quote request**. The tab shows how many documents are linked. |
| **Events** | What is planned for the opportunity — a call, a meeting, a deadline — as a list and on a calendar of its own, each with an optional reminder. The tab shows how many events have not ended yet. See *Events and reminders*. |
| **Notes**, **Messages** | The two conversations. The **Notes** tab shows how many notes there are; the **Messages** tab shows how many messages you have not read yet. |
| **Attachments** | The files. The tab shows how many are attached. |
| **Change history** | Everything that was done to the opportunity, newest first. |

**The number beside a tab's label** says how much is behind it, and a tab with
nothing behind it shows no number — so a number always means there is something
to open. On *Links*, *Notes* and *Attachments* it is the number of items: linked
documents, notes, files. On *Events* it is the events that have not ended yet.
On *Messages* it is the messages you have not read — see *Notes and internal
messages*. The numbers come with the opportunity itself, so they are there
before any tab is opened, and each follows when you add or remove an item on its
tab. What a colleague adds in the meantime appears after a reload. A screen
reader announces each number with what it counts — "Notes, items: 3",
"Events, upcoming: 2", "Messages, unread: 1".

The open tab is part of the address — `/crm/opportunities/:id?tab=links`, and
likewise `events`, `notes`, `messages`, `attachments` and `history` — so it survives a
reload and can be sent to a colleague. An address that names no tab, or one
that does not exist, opens *Overview*. Coming back from **Create order** or
**Create quote request** opens **Links**, where the new document appears.

**The facts**, in one card on the right — from the header down, beside the
stage bar and whichever tab is open — each as a small label above its value. On
a narrow screen the card comes after the stage bar and before the tabs, so the
value and the deadline are never under a long tab:

| Group | Facts | Changed here |
| --- | --- | --- |
| **Value and deadline** | The value and whether it is entered by hand or computed; the expected close date. | The value's mode, with one button. |
| **Customer and assignee** | The organization (a link to its screen), the contact person, the assignee. | The assignee. |
| **Classification** | The sales channel, where the opportunity came from, its tags. | The tags. |
| **Record** | The number, when it was created and last changed, and — once closed — when it closed. | — |

A fact with no value is shown as empty rather than left out. Everything that is
not changed in the card itself — the title, the description, the contact
person, the sales channel, the expected close date and the amount — is changed
with **Edit**.

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
| `PUT /api/v1/admin/crm/value-counting-statuses` | `crm:configure` | Replace the statuses that count towards a computed value (see *Which statuses count*). |

Every one of these writes answers the whole workflow as it stands afterwards,
except the last, which answers `202` (see *Which statuses count*).

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

On an opportunity's screen, **Edit** — in the header, for a holder of
`crm:write` — opens a form on the *Overview* tab, whichever tab you were on:
the title, the
description, the contact person, the sales channel, the expected close date and
the value. The organization and the currency are shown and cannot be changed.
The value is either **entered by hand** or **calculated from linked
documents**; the figure you entered is kept while the calculated one is shown.

Saving sends only the fields you changed. If the opportunity was changed in the
meantime — by a colleague, or by a status change you made yourself while the
form was open — nothing is saved and the form says so: press **Reload the
opportunity** to see the latest version, then make your changes again. Nothing
is ever overwritten silently.

A status change can carry a **reason**: write it in the field under the stage
bar before pressing a status. It is optional and is recorded with the change.

**Delete**, in the header of the screen, is for a holder of `crm:configure`. It
asks first, and removes the opportunity together with its status history and
its links; the linked orders themselves are not touched.

## The board

**CRM → Board** shows the opportunities you may see as cards, in one column per
status, in the workflow's order. Each column's header carries the number of
opportunities in that status and their value, one total per currency; each card
shows the opportunity's title and the fields chosen for the card — unless
somebody changed them, its number, organization, value, who it is assigned to
and its tags (see *What a card shows* below). The card's title opens the
opportunity.

A card is moved to another status in either of two ways, and both do exactly
what the stage bar on the opportunity's own screen does — linked orders
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
creation-date filters are the list's, and narrow every column, its count and
its totals alike. A column that holds more opportunities than are shown says
how many, with **Show more**.

The board is never taller than the window: a column with many cards scrolls on
its own, under a header that stays in place, so the other columns stay in
reach. A workflow with more statuses than fit side by side scrolls sideways —
with the scroll bar under the board, by swiping, or with the arrow keys once
the board itself has the focus.

An administrator who may read but not write sees the board without the grips
and the menus.

### What a card shows

A card always shows the opportunity's title. What it shows under the title is
yours to choose: on **CRM → Workflow**, the **Board card** section lists the
fields on the card, in order, and the fields that can be added. Somebody who
may configure CRM reaches it from the board too, with **Card fields**.

- **Opportunity fields**: number, organization, contact person, sales rep,
  value, sales channel, tags, expected close date, source (created by hand,
  from an order or from a quote request), the dates it was created, last
  changed and closed, and the number of linked orders and of linked quote
  requests — the last only while the Quote Requests module is on.
- **Custom fields**: every field defined for opportunities on the **Custom
  fields** screen. Define "Lead source" there, add it here, and it is on the
  card.

A card shows **at most six** fields besides the title, so that it can still be
read at a glance; the section says how many are chosen and stops offering more
once the card is full. **Move up** and **Move down** set the order, and nothing
changes until **Save**. The choice is one for the whole platform — every user
sees the same card.

Until somebody changes it, a card shows what it always did: number and
organization, value, sales rep and tags. A field an opportunity has no value
for is left out of that opportunity's card, and a long text is cut after two
lines. A custom field that is later deleted simply disappears from the cards,
from the filters and from this section; nothing has to be cleaned up.

### Filtering by what the cards show

The board has a filter for every field its cards show, of the kind the field
is:

| Field | Filter |
| --- | --- |
| A custom text field | the text it contains |
| A number or an amount — the value, a custom number, the linked-document counts | a lowest and a highest value |
| A date — expected close date, last changed, closed, a custom date | from a day, to a day |
| Yes / no | yes or no; "no" includes opportunities where it was never set |
| One of a list, several of a list, the source | one or more options; an opportunity matches when it has any of them |
| Contact person | one person, once an organization is chosen — offered to users who may edit opportunities |

The organization, sales rep, tags, sales channel and creation-date filters are
always there, whatever the card shows, and the search box finds an opportunity
by its number. Filters combine: only opportunities
that match all of them are shown, counted and totalled. The value filter
compares the amount whatever its currency.

**The filters are in the board's address.** Reload the page, bookmark it or
send the link to a colleague and the same filters are applied. **Clear
filters** removes them all. A link saved before the card was changed still
opens: a filter on a field that is no longer on the card is ignored.

### For integrators

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/board` | `crm:read` | One column per status, in workflow order: the status, `count`, `valueTotals` per currency, the first `perColumn` opportunities (default 50, at most 200) and `hasMore`; and `cardFields`, the fields a card shows, in order. Takes the list's filters except `statusCode` and `state` — the assignee and tag filters included, with the same meaning — and `fieldFilters`. |
| `GET /api/v1/admin/crm/board/card-fields` | `crm:read` | `fields`: the fields a card shows, in order. `available`: every field that can be chosen. `maxFields`: 6. |
| `PUT /api/v1/admin/crm/board/card-fields` | `crm:configure` | Body `{ "fields": ["builtin:organization", "custom:lead_source"] }` — field references, in order. Answers the configuration as it stands afterwards. `422` for a reference that names no field. |

Moving a card is `POST /api/v1/admin/crm/opportunities/:id/transition`; the
board has no write of its own for it. A column is continued from the list
endpoint, filtered to that status.

A field is named by a reference: `builtin:<key>` for an opportunity field
(`number`, `organization`, `contact`, `assignee`, `value`, `salesChannel`,
`tags`, `expectedCloseDate`, `source`, `createdAt`, `updatedAt`, `closedAt`,
`linkedOrders`, `linkedQuoteRequests`) and `custom:<field key>` for a custom
field.

Each card of the board carries `cardValues`: an object keyed by reference with
the value of every chosen field that is not already a member of the card —
the contact person's and the sales channel's names, the source, the linked
counts and the custom values — and of no field that was not chosen. The list
endpoint answers the same member when asked with `cardValues=true`.

`fieldFilters`, on the board and on the list, is a URL-encoded JSON object
keyed by reference: `{"custom:lead_source":{"in":["referral"]},"builtin:value":{"min":"1000"}}`.
The operators are `contains` (text), `min` / `max` (numbers and amounts, as
decimal strings), `from` / `to` (dates, `YYYY-MM-DD`, both days included),
`is` (yes / no) and `in` (options, and the contact person's customer-account
id). A reference that is not on the card is ignored; a parameter that is not
valid JSON of this shape answers `400`.

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

Sales representatives are assigned to an organization on the organization's own
screen, on its sales representatives tab — that list belongs to the
Organizations module, and the rule above only reads it.

**The assignee does not decide who can see an opportunity.** A sales
representative restricted to certain organizations sees every opportunity of
those organizations, whoever holds it — and does not see an opportunity of
another organization even when it is assigned to them.

In the Admin UI:

- **On the new-opportunity form** the *Assignee* field is optional. Leave it
  empty and the rule above chooses; pick a person and it is theirs.
- **On an opportunity**, *Assignee* — in the card of facts on the right —
  names who holds it. A holder of
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
is notified. **The entry is shown in the reader's own language**, English or
Polish — the same entry reads differently to two people who use different
languages. The module records the English sentence beside the translatable
one, so an entry is still readable, in English, while the CRM module is
switched off.

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
- **On an opportunity**, *Tags* — in the card of facts on the right — shows
  its tags. A holder of
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
who can no longer reach the opportunity's organization. **Nobody else is
told, unless the message mentions them** (see *Mentioning a person, an order
or a product with @*): the first message on an opportunity that has no
assignee, mentioning nobody, notifies nobody. The entry is shown in the
reader's own language, as the assignment's is. While the **Admin
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

**Unread messages.** The *Messages* tab shows how many messages of the
opportunity you have not read yet, and opening the tab reads them: the number
goes as soon as the conversation is on screen. The count is yours alone — a
colleague reading the conversation changes nothing for you — and it works the
same for somebody who may read opportunities but not write. A message you wrote
yourself is never unread. A message that arrives after you opened the tab is
unread again, and shows the next time the opportunity is loaded. Reading leaves
no trace on the opportunity: nothing appears in its change history.

When the module is upgraded to the release that introduces the count, nobody
finds the existing conversations unread: for an opportunity you have not opened
since, only messages written after the upgrade count.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/opportunities/:id/comments?kind=note` | `crm:read` | The opportunity's notes, oldest first. `kind=message` for the conversation. `kind` is required. |
| `POST /api/v1/admin/crm/opportunities/:id/comments` | `crm:write` | Write one: `{ "kind": "note" \| "message", "body" }`. |
| `PATCH /api/v1/admin/crm/opportunities/:id/comments/:commentId` | `crm:write` | Edit a note: `{ "body" }`. Its author only. |
| `DELETE /api/v1/admin/crm/opportunities/:id/comments/:commentId` | `crm:write` | Delete a note. Its author only. |
| `POST /api/v1/admin/crm/opportunities/:id/messages/read` | `crm:read` | Say that you have read the conversation up to a message: `{ "throughMessageId" }`. Answers `{ "unreadMessageCount" }` — what is left unread for you. |

Editing or deleting somebody else's note answers 403; doing either to a message
answers 409 `CRM_MESSAGE_IMMUTABLE`, whoever asks.

`GET /api/v1/admin/crm/opportunities/:id` carries `noteCount`,
`attachmentCount` and `unreadMessageCount`. The last one is counted for the
administrator who asks: two administrators reading the same opportunity get two
numbers. Marking messages read moves only your own marker, and never backwards;
`throughMessageId` has to be a message of that opportunity, or the answer is
404. How far each administrator has read is stored in the table
`crm_opportunity_message_reads`, one row per administrator and opportunity, and
goes with the opportunity when it is deleted. `crm_message_read_baselines` holds
the one instant from which unread messages are counted for somebody with no
marker.

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
| `POST /api/v1/admin/crm/opportunities/:id/attachments` | `crm:write` and `assets.read` | Attach a file that is already in the media library as a private file: `{ "assetId" }`. |
| `DELETE /api/v1/admin/crm/opportunities/:id/attachments/:attachmentId` | `crm:write` | Remove the attachment. The file stays in the media library. |

The upload answers the new attachment. It answers 413 `CRM_ATTACHMENT_TOO_LARGE`
for a file over 25 MB, and passes on the media library's own refusals — 413
`ASSET_UPLOAD_TOO_LARGE`, 415 `ASSET_UPLOAD_TYPE_NOT_ALLOWED` — unchanged. An
opportunity the person asking may not see answers 404 before anything is
stored, and a file that was stored but could not be attached is removed from
the media library again.

Attaching by `assetId` is for an integration that has already put a file in the
media library; the Admin UI does not use it. It asks for the media library's
read permission, `assets.read`, as well as `crm:write`: naming a file of the
library by its id is reading the library, so only somebody who could open the
file there may attach it. Uploading a file needs `crm:write` alone. Attaching
a file the opportunity already has changes nothing and answers the existing attachment. A file that is
not in the media library — or that is attached to an opportunity the person
asking may not see — is refused as one that does not exist. If a file has gone
missing from the media library, its attachment is still listed, under the name
it had, with no link.

## Events and reminders

An **event** is something planned for an opportunity — a call, a meeting, a
deadline. It belongs to that one opportunity and cannot be moved to another;
there is no event without an opportunity.

An event has:

- a **name** (required, up to 200 characters) and an optional **description**
  of up to 5,000 characters. The description is plain text: the `@` shortcuts
  are not offered in it;
- **one day**. Either a start and an end time on that day, the end later than
  the start, or **All day** — the date, with no times. An event cannot run over
  midnight: a meeting that does is two events;
- optionally **one reminder** — a date and a time.

Events are the opportunity's plan, not their author's property. Unlike a note,
**any** holder of `crm:write` who can see the opportunity edits and deletes
any of its events, whoever added them. When two people save the same event,
the later save wins. Adding or changing an event does not count as an edit of
the opportunity, so it never makes a colleague's open edit form fail.

Deleting an opportunity deletes its events, and none of their reminders is
sent. Closing an opportunity deletes nothing — see *Closed opportunities*
below.

### The Events tab

**Events** is the third tab of an opportunity, after *Links*. Its label counts
the events that have not ended yet.

- **Add event** (`crm:write`) opens the dialog. **Open the calendar** leads to
  **CRM → Calendar**.
- The events are listed in two groups: **Upcoming** — not ended yet, the
  soonest first — and **Past**, the latest first; the first ten are shown, then
  *Show all past events*. A row shows when the event is, its name, the first
  two lines of its description and what became of its reminder. A holder of
  `crm:write` gets **Edit** and **Delete** on every row; deleting asks first.
- Under the list the same events are drawn on a calendar of this opportunity
  alone, by **Month** or **Week**. It is not drawn while the opportunity has no
  events, nor on a screen narrower than 640 px, where the list is the
  calendar.
- Somebody with `crm:read` alone sees the list and the calendar and nothing
  that adds, changes or deletes.

The dialog, for adding and editing:

| Field | What it holds |
| --- | --- |
| **Name** | Required. |
| **All day** | Ticked: the two times leave the form and the event is the whole date. |
| **Date** | A new event opens on today. |
| **From**, **To** | A new event is offered from the next whole hour, for one hour. Moving *From* moves *To* by the same amount. An end that is not after the start is refused before anything is sent. |
| **Description** | Optional. |
| **Set a reminder** | Off by default. The hint under it says who is reminded. |
| **Remind at** | Shown when *Set a reminder* is ticked, already set to the event's start — or 09:00 on its date for an all-day event. It follows the start until you change it by hand. A time that is not in the future is refused. |

When an event is edited, a reminder time you did not touch is not judged
against the clock again, so an event whose reminder has already gone out can
still be renamed. Saving a **different** reminder time, in the future, arms the
reminder again: it is sent once more, at the new time. Unticking *Set a
reminder*, moving the reminder to another time or deleting the event stops the
reminder that was pending — even in the minute it is due, when the platform
has already picked it up for sending.

### Who is reminded, and how

A reminder is not addressed to anybody when it is written. **Who receives it
is decided at the moment it is due:**

1. the person the opportunity is assigned to **at that moment** — not the
   person it was assigned to when the event was added;
2. otherwise the person who added the event. That is the case when the
   opportunity has no assignee, and also when the assignee does not qualify;
3. otherwise nobody: nothing is sent, and the event says that there was nobody
   to remind.

A person qualifies when all three of these hold at that moment: their account
is **active**, their role holds **`crm:read`**, and they can **see the
opportunity's organization**. The same three tests apply to the assignee and
to the person who added the event — somebody who could no longer open the
opportunity is not told what is planned on it.

So a reminder reaches whoever holds the opportunity when the time comes, which
is not necessarily the person who ticked *Set a reminder*.

The reminder then goes out in up to two ways:

- **The notification bell — always.** The entry names the event, when it
  starts and the opportunity's number — *Reminder: Call back about the offer,
  October 12, 2026, 10:00 AM (Europe/Warsaw) — opportunity OPP-000042* — and
  opens the opportunity on **Events** with that event marked. The date and
  time are written in the recipient's language — the Polish month name and a
  24-hour time for somebody whose Admin UI is in Polish — and in the time
  zone the event was saved from, which is named beside them; an all-day event
  shows its date alone. They are worded when the reminder is sent, so somebody
  who changes their language afterwards keeps the date as it was written. A
  line break in the event's name is said as a space.
- **An e-mail in addition, when the person is not online.** Somebody who is
  online gets the bell entry only.

**What "online" means.** A person is online when the Admin UI has made a
request on their behalf in the last five minutes. An open Admin UI asks for
new notifications every 30 seconds, so in practice online means *has the
Admin UI open in a browser* — on any device. It does not know whether anybody
is looking at the screen: a person who left their desk with the tab open gets
the bell entry and no e-mail. Closing the browser, or signing out, makes a
person offline five minutes later at most.

**The e-mail** is the transactional e-mail **Event reminder**
(`crm_event_reminder`). It carries the same three facts as the bell entry —
the event's name, when it starts and the opportunity's number — and is written
in the language of the recipient's Admin UI: Polish for a Polish preference,
English otherwise. It is sent with the platform-wide branding, not a sales
channel's.

**The e-mail carries no link.** It names the opportunity by its number and
asks the reader to open it in the Admin UI; the bell entry is the one that
links to it. Neither the bell entry nor the e-mail ever carries the event's
description or the opportunity's title.

An operator edits the e-mail's subject and body, per language, on the
**Transactional Emails** screen (`/transactional-emails`), and can switch it
off there. The variables it offers are `event.name`, `event.when` and
`opportunity.number`. **An e-mail that does not go out never costs the bell
entry** — switched off by the operator, no address on the recipient's account,
a mail server that refuses: the bell entry is written all the same, the event
shows the reminder as sent by the bell, and the server's log says why the
e-mail was not sent.

While the **Admin notifications** module is switched off there is no bell, so
the e-mail is sent whether or not the person is online. When there is neither
a bell nor an e-mail that went out, the event says that the reminder could not
be delivered.

**An instance with no mail server configured.** Without an SMTP connection
(`SMTP_URL`, or `SMTP_HOST` and its companions) the platform writes every
e-mail to the server's log instead of sending it, and counts it as sent. A
reminder for somebody who is offline is then shown as sent by the bell *and*
by e-mail although no message reached a mailbox. The bell entry is there when
they come back; configure SMTP before relying on the e-mail.

### When a reminder is sent, and when it is not

Reminders are looked for once a minute, so one arrives up to a minute after
its time. Each is delivered **at most once**.

- **Late, up to 24 hours.** A reminder that could not be sent at its time —
  the platform was down, CRM was switched off, the opportunity was closed — is
  sent as soon as it can be, if that is within 24 hours of its time.
- **More than 24 hours late, it is skipped**: not sent, and shown as *missed*.
- **Held while the opportunity is closed.** Nothing is sent for a closed
  opportunity, and the reminder is not used up: reopen the opportunity within
  24 hours of the reminder's time and it is sent then. Later than that it is
  *missed* — and reads so even while the opportunity is still closed.
- **Not sent while CRM is switched off**, under the same 24 hours.
- **Interrupted.** If the server stops in the middle of a delivery, it cannot
  know whether the bell entry was written. The reminder is not tried again —
  it would risk a second one — and after ten minutes the event says that the
  reminder was interrupted and may not have been delivered.

What the Events tab says about each reminder:

| The tab says | Meaning |
| --- | --- |
| *Reminder scheduled for …* | It is still to come. |
| *Reminder for … is held while the opportunity is closed* | Nothing is sent until the opportunity is reopened. |
| *Reminder sent … — notification bell* (and, or instead, *e-mail*) | Delivered, when, and by which of the two ways. |
| *Reminder for … was missed — it was not sent* | It was found more than 24 hours late. |
| *Reminder for …: there was nobody to remind* | Neither the assignee nor the person who added the event qualified. |
| *Reminder for … could not be delivered* | The bell is switched off and no e-mail went out. |
| *Reminder for … was interrupted and may not have been delivered* | The process that was sending it stopped before it could record the result. It is not repeated. |

### Closed opportunities

A closed opportunity — won or lost — **keeps its Events tab**, its events and
their editing. Two things change while it is closed, and the tab says so in a
note: its events are **not shown on the Calendar**, and its reminders are
**held**. Reopening the opportunity brings both back; no event is changed by
closing or reopening.

### Time zones

The platform has no time-zone setting, so an event carries its own: the time
zone of the browser it was saved from.

- A **timed** event is one moment, the same for everybody. Each reader sees it
  at their own local time.
- An **all-day** event is a date, the same date for everybody, wherever they
  read it.
- **The one-day rule is judged in the time zone the event is saved from.** An
  event from 23:00 to 23:30 in Warsaw is one day and is accepted, although for
  a reader in Tokyo it falls on the next morning. The other way round, an
  event planned in Warsaw for 16:30 – 17:30 whose time is later **changed from
  a browser in Tokyo** is judged there — where it runs from 23:30 to 00:30 —
  and refused. Changing only its name or description does not judge its time
  again.
- The bell entry and the e-mail have no browser to follow, so they state the
  time in the event's own time zone and name it.

### In the change history

Adding, changing and deleting an event are entries of the opportunity's
change history — *Event added*, *Event changed*, *Event deleted* — with who and
when, the event's name, whether it is all day, its start and end, and its
reminder time. The description's text is not in the history: only how long it
was. What became of a reminder is not an entry either; it is shown on the
Events tab.

### For integrators and operators

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/opportunities/:id/events` | `crm:read` | The opportunity's events, by start; at most 500. |
| `POST /api/v1/admin/crm/opportunities/:id/events` | `crm:write` | Add one: `{ "name", "description", "allDay", "startsAt", "endsAt", "timeZone", "remindAt" }`. |
| `PATCH /api/v1/admin/crm/opportunities/:id/events/:eventId` | `crm:write` | Change the members sent. The rules are applied to the event as it would be after the change. `"remindAt": null` removes the reminder. |
| `DELETE /api/v1/admin/crm/opportunities/:id/events/:eventId` | `crm:write` | Delete it. |

- `startsAt` and `endsAt` are ISO 8601 instants with an offset; `endsAt` is
  exclusive. `timeZone` is the IANA name of the zone the times were chosen in
  — `Europe/Warsaw`. For `"allDay": true` the two instants are the local
  midnight that starts the date and the next local midnight, in that zone.
- An event in the answer carries `allDayDate` — the date of an all-day event,
  `null` for a timed one — and `reminder`: `null`, or `{ at, state, handledAt,
  channels }`, where `state` is one of `scheduled`, `paused`, `sent`, `missed`,
  `no_recipient`, `undeliverable`, `interrupted` and `channels` lists `bell`,
  `email` or both when the state is `sent`.
- `GET /api/v1/admin/crm/opportunities/:id` carries `upcomingEventCount`, the
  number the tab's label shows.
- An opportunity the caller may not see answers 404
  `CRM_OPPORTUNITY_NOT_FOUND` on all four routes, exactly as one that does not
  exist; an `:eventId` that is not an event of that opportunity answers 404
  `NOT_FOUND`. A malformed body answers 400 `VALIDATION_FAILED` — and so does
  a `startsAt`, `endsAt` or `remindAt` outside `0001-01-03T00:00:00Z` …
  `9999-12-30T00:00:00Z`. A well-formed
  event the rules refuse answers **422** `VALIDATION_FAILED` with
  `details.field` and `details.rule`: `ends_before_start`, `spans_days`,
  `not_whole_day`, `unknown_time_zone` or `reminder_in_past`.

Events are stored in the table `crm_opportunity_events`, which the module's
migration creates. An event has no organization of its own: it is reached
through its opportunity, and seen by exactly the people who may see that
opportunity.

Reminders are delivered by a background worker on the queue
`crm-event-reminders`, which wakes every 60 seconds and reads what is due from
the table. **An instance that runs no worker process delivers no reminder**;
what was due is sent, up to 24 hours late, once a worker runs. Nothing is kept
in Redis but the clock, so a flushed Redis loses no reminder, and several
worker processes may run at once without sending any reminder twice.

No event is published on the event bus for an event being added, changed or
deleted, and none of it is offered to outbound webhooks.

## The calendar

**CRM → Calendar** (`/crm/calendar`) shows events across opportunities. It
opens for a role that holds `crm:read`, and is in the command palette as
**CRM calendar**.

### Which events appear

- **Only events of open opportunities.** An opportunity in a status that
  closes it — as won or as lost — has none of its events on the Calendar.
  Reopen it and they are back. Its Events tab shows them throughout.
- **Only events of opportunities you may see**, as everywhere in the module.
- **Whose events** depends on how far your access reaches:

| Who | What the Calendar shows |
| --- | --- |
| An administrator who may see **every** organization | The events of every open opportunity. A **Mine / All** switch narrows the Calendar to the opportunities assigned to them. It opens on *All*, where each event also names the opportunity's assignee. |
| An administrator restricted to a set of organizations — a sales representative | Only the events of opportunities **assigned to them**, within those organizations. There is no switch. |

A sales representative's Calendar therefore never shows a colleague's
opportunity, even one in an organization they share — although they can open
that opportunity and read its Events tab. An opportunity still assigned to
somebody who has since lost its organization is not on their Calendar either.

**Reassigning an opportunity moves all its events at once.** An event has no
assignee of its own: whose Calendar it is on follows from who the opportunity
is assigned to when the Calendar is read. After a reassignment the events are
on the new assignee's Calendar and no longer on the former one's, with nothing
to carry over — and every reminder still to come goes to the new assignee.

### Views and navigation

| View | What it shows |
| --- | --- |
| **Month** | Six weeks, Monday first. Up to three events a day — all-day ones first — and *+N more*, which opens that day in the *Day* view. |
| **Week** | Seven days from Monday: a row of all-day events, then the hours of the day, each event at its time and for its length. Events that overlap stand side by side. A line marks the current time on today. It opens scrolled to 07:00. |
| **Day** | The same for one day. |
| **Agenda** | A list of the days that have events, over 30 days from the chosen date. |

- **Today**, **Previous** and **Next** move by a month, a week, a day or 30
  days, according to the view; **Go to date** jumps to a date; the title names
  the range shown.
- The view, the date and *Mine / All* are in the address —
  `/crm/calendar?view=week&date=2026-10-12&scope=mine` — so a reload and a
  shared link show the same thing. `view` is `month`, `week`, `day` or
  `agenda`; `scope` is `mine` or `all`. The defaults are left out of the
  address, so a bare `/crm/calendar` always opens the current month on today.
  An address that asks for `scope=all` on behalf of somebody who has no such
  choice opens their own events, not an error.
- **On a phone the Calendar is the Agenda.** Under 640 px of width it shows the
  list whatever view the address names, and offers no view switch.
- **Every event is a link to its opportunity.** It opens the opportunity on
  the **Events** tab with that event marked
  (`/crm/opportunities/:id?tab=events&event=…`). An event shows its start time,
  its name, and the opportunity's number and title; a bell marks one that has a
  reminder.
- **The Calendar changes nothing.** There is no button that adds an event and
  nothing can be dragged: an event is added, edited and deleted on its
  opportunity.

Times are shown in the time zone of your browser, which the screen names under
the toolbar. They are written the way the language of your Admin UI writes
them — 13:05 in Polish, 01:05 PM in English. The week starts on Monday in both
languages.

When nothing is planned in the range the Calendar says so and offers the way
back to today; while it loads, and when loading fails, it says that too, with
**Retry**.

### Limits

- One read covers **at most 45 days** — enough for the six weeks of a month
  with a day to spare on each side. A wider range answers 400, and so does a
  `from` or a `to` outside `0001-01-03T00:00:00Z` … `9999-12-30T00:00:00Z`.
- One read returns **at most 500 events**, the first 500 by start time. When
  there were more, the Calendar says that the range is incomplete and suggests
  a shorter range or *Mine*.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/calendar/events?from=…&to=…&scope=…` | `crm:read` | The events that overlap the range `from` (inclusive) to `to` (exclusive), both ISO 8601 instants, by start. `scope` is `mine` or `all` and optional. |

The answer is `{ data, meta }`. An entry of `data` carries `id`, `name`,
`allDay`, `startsAt`, `endsAt`, `allDayDate`, `hasReminder` and its
`opportunity` — `id`, `number`, `title` and `assignee` — and never the
description. `meta` is `{ scope, scopes, truncated }`: `scope` is the one that
was applied, `scopes` the ones this caller may ask for, and `truncated` is
`true` when more than 500 events matched. **The scope is the server's
decision**: a caller restricted to a set of organizations is answered with
`mine` whatever was asked. This route has no 404 — it only ever answers what
the caller may see.

An all-day event is a date in its **own** time zone, so for a reader far to the
east or west that date can begin outside the days their own screen shows. The
Admin UI therefore asks for one day more on each side of what it draws, and
places an all-day event by `allDayDate`.

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
| Most effective sales reps | How many opportunities each sales rep closed as won, and what they were worth — for the whole range, and month by month (calendar months, in UTC). The sales rep is the person the opportunity is assigned to **now**: an opportunity reassigned after it was won counts for its current assignee. | Those closed as won in the range and assigned to somebody. |
| Most valuable opportunities | The ten opportunities with the highest value, each a link to the opportunity. Choose whether the range goes by the creation date or by the closing date. | Those created — or closed — in the range that have a value. |
| Average opportunity value | The mean value of an opportunity. | Those created in the range that have a value. |

**Amounts in different currencies are never added together.** The platform has
no exchange rate, so every figure about value is given per currency: an average
for each currency, a list of the most valuable opportunities for each currency,
and each sales rep's won value for each currency.

The **value** of an opportunity is the one shown on it: the amount entered by
hand, or — when the opportunity is set to be computed — the amount computed
from its linked documents. "Most valuable" means the highest value and nothing
else: the module knows no cost and no margin, so no figure here is a profit.

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

**An order placed from a linked quote request joins the opportunity by
itself.** When the customer orders an accepted quote request, the order records
the quote request it came from, and if that quote request is linked to an
opportunity the order is linked to the same one (`linkSource:
"quote_conversion"`) — once, whether the opportunity is still open or already
closed, and whatever `crm.auto_create_from_orders` says: such an order never
gets an opportunity of its own. From then on it is a linked order like any
other: it follows the order-status mappings, and the opportunity's value counts
it.

The order records its quote request when it is placed from the basket the
customer filled by ordering the accepted quote request on its page in the
storefront, while the quote request is still approved and at least one line is
still in the basket at the agreed price. Adding a product
or changing a quantity keeps it. A basket that was emptied and filled again by
hand, or that keeps none of the agreed lines, makes an ordinary order: it is
not linked by itself, and the quote request stays open. With the Quote Requests
module switched off, an order is placed as usual and records no quote request.

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
request are one piece of business: while the order counts, the quote request is
left out, so the value is the order's figure and not the two added. An order
and a quote request that are both linked but have nothing to do with each other
are both counted.

**One currency.** An opportunity has one currency and nothing is converted. A
document in another currency that would otherwise count is left out, and the
opportunity names it: `excludedDocuments` on the opportunity lists each one as
`{ kind, id, reason: "currency_mismatch" }`. A quote request with lines in
several currencies counts the lines in the opportunity's currency and is named
as well.

The value follows the documents: it is recalculated when a document is linked
or unlinked, when a linked order changes status, when a linked quote request is
modified, approved, canceled or expires, and when the mode becomes computed.
It follows an order's **status**, not its amount: an order whose total is
changed without a status change, and a quote request that becomes `Completed`,
are picked up at the next recalculation.
A recalculation is not an entry in the opportunity's history.

**The opportunity's own screen always shows the live figure.** Opening an
opportunity computes its value from the linked documents as they are at that
moment, and queues a recalculation when the stored figure differs. The list,
the board and the analytics read the stored figure, so they may lag behind the
opportunity's screen until the background recalculation has run — normally a
moment, longer while the queue is busy or its worker is stopped.

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

On an opportunity's screen:

- **Linked quote requests**, on the **Links** tab, lists each one with its
  number, its status and its net value, under *Linked orders*. A holder of `crm:write` searches the
  organization's quote requests by number and links one, or unlinks one. The
  search offers the open quote requests; a closed one is found by typing its
  full number. Linking needs `rfqs:handle` as well; without it the section
  says so instead of offering the search.
- **Value**, in the card of facts on the right, shows the figure and whether
  it is *entered by hand* or a *computed value*, and one button switches
  between the two. For a computed value it
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
default, and both are switched on the platform's **Settings** screen, in the
*CRM* group. Their names there are in English only: the platform's settings
have no translatable labels yet.

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
- nothing for an order that records a quote request linked to an opportunity —
  the order joins that opportunity instead, whatever the settings say (see
  *Linking quote requests*);
  records its quote request today, so this is not effective yet (see *Linking
  quote requests*);
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

On the **Links** tab of an opportunity, the *Linked orders* section has a
**Create order** button and the *Linked quote requests* section a **Create
quote request** button. Each opens the platform's own create screen — the one
under **Orders** or **Quote requests** — already narrowed to the opportunity's
organization: the customer search offers that organization's people, the
opportunity's contact person arrives chosen, and so does its sales channel on
an order.

Fill the screen in as usual and save. You are brought back to the opportunity,
on its **Links** tab, which says that the new document is being linked and then that it is; the
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
unlinked, each assignment, tag change, note, message, attachment and event.

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

Five things to know:

- A note or a message is in the history as the fact that it was written,
  edited or deleted — by whom, and how long it was. Its text is not: that is
  read on the *Notes* and *Messages* tabs.
- An event is in the history with its name and its times, never with the text
  of its description. A reminder being sent is not an entry.
- Recalculating a computed value is not an entry: the change that caused it —
  a link, an order's status — is.
- An entry that carries a description — the creation, an edit of it — also
  carries `references`, exactly as the opportunity itself does: what the
  people, orders and products mentioned in that text are called, for the
  reader. The text is returned as it was recorded.
- The history reaches back 499 entries. When an opportunity has more, the last
  page answers `"truncated": true` beside `pagination`, and the tab says that
  earlier changes exist and are not shown; otherwise it is `false` and the tab
  says that this is the whole history. `hasMore` only ever means that there is
  a next page to ask for.

On the platform-wide **Audit log** screen the same entries appear among
everybody else's, as the same sentences.

In the Admin UI the history is the **Change history** tab of an opportunity.
Each entry is a sentence — *Opportunity status changed*, *Note added* — with
who did it and when. A status change shows the two statuses by name; when an
order caused it, the entry names that order and links to it. An edit lists the
fields that changed, as they were and as they are. Custom field values are
listed a line per field under the fields' own labels — or under their codes for
somebody without `custom_fields:read` — and an order's status is shown by name,
to somebody holding `orders:read` only. A description that changed reads as it
does on the *Overview*: a person, an order or a product it mentions is shown by
name, never as the token. *Show earlier changes* reads the next page.

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
buttons under them, **Insert order** and **Insert product** among them. Each
opens a search;
choosing a result puts it into the text where the cursor was — **as its name,
never as the token**: the field shows the order's number or the product's name
as a small label while you write, and the token is only what is stored. Once
saved, the text shows that name as a link in its place, and
*Product unavailable* / *Order unavailable* for a target that is gone or that
you may not see — in the saved text and in the field alike when it is opened
for editing; what you cannot see is saved back unchanged. A name is shown only to somebody who could open the target
itself: an order's number needs `orders:read`, a product's name
`catalog:read`.

The two searches are the catalogue's and the Orders module's own, so *Insert
product* is offered to a role that also holds `catalog:read` and *Insert order*
to one that holds `orders:read`; orders are offered for the opportunity's
organization only. A token typed or pasted by hand is saved without either,
and reads as unavailable to whoever lacks the permission.

## Mentioning a person, an order or a product with @

The same three fields — the description, a note, a message — take a mention
straight from the keyboard:

| Type | To mention | Offered to |
| --- | --- | --- |
| `@` | a **person** — a user of the Admin UI who may read opportunities | anybody writing the text |
| `@@` | an **order** of the opportunity's organization | a role that also holds `orders:read` |
| `@@@` | a **product** | a role that also holds `catalog:read` |

Type the `@` at the start of the text or after a space and a list opens **where
you are typing** — under that line, or above it when there is no room below;
keep typing to narrow it — a first name, a surname, an order number,
a product name or SKU. **Arrow keys** move through the list, **Enter** or
**Tab** chooses, **Escape** closes it and leaves what you typed. Choosing
replaces the `@` and the letters after it with the mention — shown as
**@Tomasz Nowak**, as an order's number or as a product's name — and you carry
on with the sentence:

```text
@Tomasz Nowak - take this over
```

**The field shows names, never tokens**, for a mention just chosen and for
every one already in a text you open for editing. A mention behaves as one
character: the arrow keys step over it, and **Backspace** or **Delete** removes
the whole of it. The field is plain text — a paste arrives as its text with its
line breaks and none of its formatting — and **Ctrl+Z** / **Ctrl+Shift+Z** undo
and redo, a mention being one step. A token typed or pasted by hand turns into
its name when the field knows it, and otherwise stays as you typed it and is
resolved when the text is saved. Typing `@@` or `@@@` quickly opens the one
list you asked for; a single `@` opens the people after a short pause.

An `@` inside a word — an e-mail address — opens nothing, and neither does an
`@` followed by a space. A shortcut your role is not offered leaves the
characters exactly as typed. The line under the field names the shortcuts you
have, and **Mention a person** beside *Insert order* and *Insert product* does
the same by a button.

A mention of a person is stored like the other two, as a token, and comes back
in `references`:

```text
[[admin_user:<administrator id>]]
```

```json
{
  "type": "admin_user",
  "id": "8a1f…",
  "available": true,
  "label": "Tomasz Nowak",
  "url": null
}
```

- `label` is the person's **current** name. It is shown to everybody who reads
  the text as **@Tomasz Nowak**, set apart from the sentence.
- `url` is always `null`: a mention of a person is not a link.
- Somebody who was removed or deactivated since comes back with
  `"available": false` and no name, and reads *Person unavailable*.

**Who can be mentioned.** The list offers active administrators who hold
`crm:read` and who may see the opportunity's organization — a mention is a call
to come and look, so it is offered only of somebody who can.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/lookups/mentionable?q=…&organizationId=…` | `crm:write` | The people a text may mention, by name: `id`, `name`. With `organizationId`, only people who may see that organization — and nobody when the caller may not. |

**Who is told.** When a description, a note or a message is saved, every person
it mentions **who was not already mentioned in the text it replaces** gets one
entry on the notification bell, with a link to the opportunity:

```text
Anna Kowalska mentioned you in opportunity OPP-000042
```

- The entry names the opportunity by its number and the author by name. It
  carries nothing of the text.
- One entry per person per save, however often the text names them. Saving the
  same text again, or rewording it around the same mention, tells nobody;
  taking a mention out and putting it back tells that person again.
- **Nobody is told about mentioning themself**, and no entry is written for
  somebody who does not hold `crm:read`, who was deactivated, or who cannot see
  the opportunity's organization. The token is text and can be typed by hand, so
  this is decided when the text is saved, not by the list.
- In a message, a mentioned person gets this entry **instead of** the one a
  participant of the conversation gets, not both.
- The entry is shown in the reader's own language — the line above is its
  English form — and none is written while the **Admin notifications** module
  is switched off; the text is saved all the same.

A mention changes nothing else: it does not assign the opportunity, does not
give anybody access to it, and is not part of any event or webhook.

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
screen, the definitions already made for it are **hidden** — they are not
listed, and reading one by its id answers `404` — and none can be created,
changed or deleted (`409`). Nothing is removed: switching CRM back on restores
the definitions and every stored value.

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

## The opportunity on the order's and the quote request's screen

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

**A quote request's screen ends with the same panel**, for a quote request:
the opportunity it is linked to, or — for a holder of `crm:write` — *Link to an
opportunity* and *Create opportunity*, which carry the quote request instead of
an order. Whoever is on that screen holds `rfqs:handle`, which linking a quote
request needs. With the Quote Requests module switched off there is no such
screen and no panel; the order's panel is unaffected.

For integrators: `GET /api/v1/admin/crm/documents/order/{orderId}/opportunity`
(`crm:read` and `orders:read`) answers `{ "data": <the opportunity's summary> }`, or
`{ "data": null }` for an order linked to none. An order that does not exist or
is not the caller's to see answers `404 CRM_DOCUMENT_NOT_FOUND` — the same
answer for both, whether or not it is linked. A kind other than a document
kind answers `422`. `…/documents/quote_request/{quoteRequestId}/opportunity`
answers the same for a quote request and asks for `crm:read` and `rfqs:handle`;
while the Quote Requests module is switched off it answers `503
MODULE_DISABLED`, whoever asks. The create form accepts `linkDocumentKind=order`
or `quote_request` and `linkDocumentId=<the document's id>` beside
`organizationId` in its address.

For module authors: the panel is CRM's contribution to the `order.detail.after`
and `quote_request.detail.after` admin zones, which the Orders and the Quote
Requests modules mount and which any module may contribute to. Neither imports
CRM or declares a dependency on it.

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
import { opportunityStatusEventName } from '@endora-commerce/contracts';

ctx.subscribe(opportunityStatusEventName('toAfter', { to: 'won' }), async (event) => {
  await notifyFinance(event.opportunityId);
});
```

**Refuse a move** by registering a guard. A guard names the moves it watches —
from a status, to a status, or both — and refuses by throwing
`OpportunityTransitionVetoError`. The sentence it throws is what the sales
representative reads; nothing is written when a guard refuses.

```ts
import {
  OpportunityTransitionVetoError,
  type OpportunityTransitionGuardRegistryPort,
} from '@endora-commerce/contracts';
import { lazyPort } from '@endora-commerce/platform/kernel';

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

**A guard runs whatever causes the move** — a person, another module through
the port, or a linked order through a mapping. When an order caused it, nobody
is there to read the refusal: the opportunity stays where it is and the skipped
change is recorded on it with the guard's sentence (see *An order that moves
its opportunity*).

Two more events are published for other modules, neither tied to a status:
`crm.opportunity.assigned.v1` (the new and the previous assignee) and
`crm.opportunity.document_linked.v1`, emitted whenever an order or a quote
request is linked — by hand, automatically, or because it was created from the
opportunity — with `opportunityId`, `organizationId`, `documentKind`,
`documentId` and `linkSource`. Neither is offered as a webhook.

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
- nothing it would do in the background happens — in particular **no event
  reminder is sent**. A reminder that fell due while the module was off is sent
  once it is switched on again, if that is within 24 hours of its time; later
  than that it is shown as missed.

Nothing is deleted. Every opportunity, its history, its events and the workflow
configuration stay in the database, and everything is back exactly as it was
when the module is switched on again.

## Permissions

| Code | What it allows |
| --- | --- |
| `crm:read` | View sales opportunities, the board, the calendar, the status workflow and the tag list; read an opportunity's change history, its events, its notes and messages, and download its attachments. Best granted together with `orders:read` and `custom_fields:read` (see below). |
| `crm:write` | Create and edit opportunities, move them through the workflow, assign them, tag them, link and unlink orders and quote requests, choose whether the value is typed in or computed, retry or dismiss a refused order change, write notes and messages, upload, add and remove attachments, and add, edit and delete events — anybody's, not only their own. |
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

**Nothing else is needed to fill in a form.** The fields that choose an
organization, a sales channel, an assignee or a contact person — in the filters of the list and the
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
| `GET /api/v1/admin/crm/lookups/mentionable?q=…&organizationId=…` | `crm:write` | Active administrators holding `crm:read` — the people a text may mention: `id`, `name`. |
| `GET /api/v1/admin/crm/lookups/quote-requests?organizationId=…&q=…` | `crm:write` and `rfqs:handle` | Quote requests of one organization the caller may see that can be linked: the open ones, and the one whose number is typed in full. `id`, `number`, `status`. Answers `503` while the Quote Requests module is off. |

The currencies offered when an opportunity is created are the ones the active
sales channels sell in.

**Events and the calendar have no permission of their own.** `crm:read` is
also what a person must hold to **receive** an event's reminder. What a person's
calendar shows — everybody's events or only their own — follows from whether
they may see every organization or a set of them, not from a code (see *The
calendar*).

No role receives a CRM permission automatically. Grant them on the
**Roles** screen.

## Settings

On the platform's **Settings** screen, in the *CRM* group. The names shown
there are in English only.

| Setting | Default | Meaning |
| --- | --- | --- |
| `crm.enabled` | on | The switch described above. |
| `crm.auto_create_from_orders` | off | Every order placed from then on gets an opportunity of its own. The setting can differ per sales channel; the order's channel decides. |
| `crm.auto_create_from_quote_requests` | off | Every quote request created from then on — submitted by a customer or prepared by an administrator — gets an opportunity of its own. Needs the Quote Requests module to be on. |
| `crm.board_card_fields` | number, organization, value, sales rep, tags | The fields a board card shows, in order, as a list of field references. Change it in the **Board card** section of **CRM → Workflow**, which offers the fields that exist, rather than here. |

Events, reminders and the calendar add no setting. The reminder e-mail is
edited and switched off on the **Transactional Emails** screen, as *Event
reminder*; how often reminders are looked for, the five minutes that make a
person online and the 24 hours after which a late reminder is skipped are
fixed.

## What the module does not do

Things an operator may look for and will not find in this release:

- **Import and export** of opportunities — there is neither a file import nor
  an export.
- **E-mail, with one exception.** An event's reminder can also be an e-mail
  (see *Events and reminders*). Every other notification goes to the bell in
  the Admin UI only, and a message is internal to the people working the
  opportunity.
- **Events over several days, and repeating events.** An event is one day; a
  fair that lasts three days is three events, and a weekly call is added week
  by week.
- **Changing the calendar by hand.** Nothing is dragged or resized on it, and
  an event is not created from it: the Calendar is a view, and events are
  added on their opportunity.
- **Kinds and colours of events.** There is one kind of event, drawn in one
  colour; it has no category, no location field and no participants, and
  nobody is invited to it.
- **Events without an opportunity** — a personal calendar.
- **Synchronisation with another calendar.** There is no Google Calendar or
  Outlook synchronisation and no iCalendar export.
- **A link in the reminder e-mail.** The e-mail names the opportunity by its
  number; the bell entry links to it.
- **A time-zone setting.** The calendar follows each reader's browser.
- **Events elsewhere in the module.** Events are not offered to outbound
  webhooks, do not appear in analytics, and are not a field of a board card.
- **Global search.** Opportunities are found on their own list and board, not
  through the Admin UI's search.
- **Profit.** Every figure is a value; there is no cost or margin.

## Demo data

Demo data is optional: an instance that sells for real needs none of it, and
none is created unless you run `endora demo seed`. When you do, CRM gets a
pipeline to look at:

- **Three tags** — `Key account`, `Upsell` and `Tender`. These are the module's
  own demo data.
- **Twelve opportunities** for the demo organization, two in each status of the
  default workflow (new, qualified, proposal, negotiation, won, lost). Six are
  assigned to one demo sales representative, five to the other and one to
  nobody. Eleven carry a value entered by hand; one is set to be calculated
  from its linked documents and is worth zero until something is linked to it.
- **A history** for each of them, dated over the three months before the seed,
  so the analytics screen has closed opportunities, time in status and more
  than one month to show.
- **Notes** on four of them and an exchange of **internal messages** on one —
  one note naming a demo product, one message mentioning a person; the demo
  buyer as contact person on four; tags on nine.
- **Eight events** on six of the eight open opportunities — site visits, calls
  and two all-day deadlines — so the calendar and the Events tab are not empty.
  They are dated from the day of the seed: seven in the two weeks after it and
  one five days before. **None has a reminder**, so a seeded demo writes no
  bell entry and sends no e-mail. The four closed opportunities have no event.

The opportunities are created by the demo composition package
(`@endora-commerce/demo-composition`), because each belongs to an organization
and to an administrator — records of other modules. An instance that did not
install that package gets the three tags only.

What the demo pipeline does not have:

- **No linked order or quote request.** The demo shop contains neither, so no
  opportunity has a linked document and none shows order-status
  synchronisation at work. Create an order from a demo opportunity to see it.
- **No change history.** The History tab of a seeded opportunity is empty: the
  demo writes the records directly, with past dates, and the tab shows only
  what was done through the Admin UI or the API. Everything you do to a demo
  opportunity afterwards is recorded as usual.
- **No mappings.** The workflow configuration is left exactly as installed.

Seeding again changes nothing that is already there: an opportunity you moved
or edited stays as you left it — and an opportunity seeded before events
existed gains none; reset and seed again to get them. `endora demo reset` removes the twelve
opportunities and the three tags, with everything attached to those
opportunities, and nothing you created yourself.

**Run `endora demo reset` with the CRM module switched on.** While the module
is off its records are left alone — including the demo opportunities — and the
demo organization they belong to cannot be removed, so the reset stops with an
error at `organizations`. Switch CRM on and run it again.
