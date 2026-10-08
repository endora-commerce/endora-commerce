---
'@endora-commerce/mod-crm': minor
---

A new module package, `@endora-commerce/mod-crm` (module id `crm`): sales opportunities with a
configurable status workflow that linked orders follow. Backend and Admin UI. This is the
module's first release.

**What installing it does.** Thirteen `crm_`-prefixed tables and a default workflow of six
statuses (`new`, `qualified`, `proposal`, `negotiation`, `won`, `lost`) arrive with the next
migration run — three migrations. An instance that does not install it is unaffected. The module
is optional: `crm.enabled`, on by default, switched on `/platform/modules`; while it is off
every route answers `503 MODULE_DISABLED`, its screens, panels, permissions and settings are
withdrawn, and nothing is deleted. It depends on `orders`, `organizations`, `sales_channels`,
`catalog`, `assets_library`, `custom_fields`, `audit_logs` and the platform's account and
settings modules, and degrades without `quote_requests`, `admin_notifications` and `webhooks`. One queue consumer,
`crm-value-recalculation`. Peers: `fastify`, `@fastify/multipart`, MikroORM, `bullmq`,
`ioredis`, `zod`, and — optional, for the admin layer only — `@endora-commerce/admin-kit`,
`react`, `react-router-dom`, `lucide-react`. Its own demo data is three tags (`Key account`,
`Upsell`, `Tender`); the demo sales pipeline that carries them is a step of
`@endora-commerce/demo-composition`. `./backend` also exports `nextOpportunityNumber(em)`, the
next `OPP-…` number from the module's sequence, for that step.

**Permissions**, none granted to any role automatically: `crm:read`, `crm:write`,
`crm:configure`, `crm:analytics`. `crm:read` advises `orders:read` and `custom_fields:read`.
What another module owns is shown to somebody who may read it there: a linked or mentioned
order needs `orders:read`, a quote request `rfqs:handle`, a mentioned product `catalog:read`;
without it the document is listed as unavailable and nothing of it is shown.

**The API**, all under `/api/v1/admin/crm`, tenant-scoped throughout (an opportunity of an
organization the caller may not see answers `404 CRM_OPPORTUNITY_NOT_FOUND`):

- **Workflow** — `GET /workflow`; `POST|PATCH|DELETE /statuses`; `PUT /transitions`;
  `PUT /order-status-mappings` (both directions); `PUT /value-counting-statuses` (answers 202
  and recalculates in the background). A change that would break the workflow answers
  `422 CRM_WORKFLOW_INVALID` naming the rule in `details.rule`.
- **Opportunities** — list (search, filters by state, status, organization, assignee, tags,
  sales channel, creation date; sorting; cursor paging), create, read, `PATCH` under
  `If-Match` (409 for a stale version, 400 for a header that is not one), delete
  (`crm:configure`), `POST …/transition`, `POST …/assign`, `PUT …/tags`.
- **Linked documents** — `POST|PATCH|DELETE …/links` for orders and quote requests. A document
  belongs to at most one opportunity, of its own organization.
  `GET /documents/:kind/:id/opportunity` answers the opportunity a document is linked to.
- **Orders follow, and lead.** A move asks every linked order that follows the opportunity to
  enter the mapped order status, through the Orders module's own transition rules, after the
  opportunity's change has committed. A refusal is not an error: the response is 200, the
  opportunity has moved, and each order's outcome is in `propagation`, addressed afterwards by
  `…/propagations/:id/retry` and `…/dismiss`. In the other direction a linked order reaching
  a mapped status moves its opportunity through the opportunity's own workflow; a closed
  opportunity is never reopened, and the two directions do not loop.
- **Value** — entered by hand, or computed from linked orders (gross total) and quote requests
  (net sum of lines) in a counting status; one currency, nothing converted, documents left out
  listed in `excludedDocuments`.
- **Tags** (`/tags`), **notes and internal messages** (`…/comments`: a note is its author's to
  edit or delete, a message is immutable), **attachments** (`…/attachments/upload` under
  `crm:write` alone, stored in the media library as a private file, at most 25 MB, active
  content refused; attaching an existing library file by id also needs `assets.read`).
- **Change history** — `GET …/history`, read from the platform's audit trail under `crm:read`,
  reaching back 499 entries and answering `truncated: true` on its last page when there are more;
  the text of a note or a message is never in it, and the tab shows every audited value in
  words — custom field values under the fields' own labels, an order status by name to a
  reader holding `orders:read`.
- **References** — `[[product:<uuid>]]`, `[[order:<uuid>]]` and `[[admin_user:<uuid>]]` in a
  description, note or message are resolved into `references` beside the text — and beside a
  description in the change history. A mentioned person is named and never linked.
- **Mentions** — in the Admin UI, typing `@`, `@@` or `@@@` in those fields opens a search
  of people, the organization's orders or products at the caret and inserts the choice. The
  field shows every reference by its name while it is being written or edited, never the
  token; what is stored and sent is the token text, unchanged. A person newly mentioned in a
  saved text gets one bell entry, `crm.opportunity.mention`, naming the opportunity by number
  and the author by name; never the author themself, nobody without `crm:read`, nobody who
  cannot see the organization.
- **Bell entries in the reader's language** — the three kinds the module records
  (`crm.opportunity.assigned`, `crm.opportunity.message`, `crm.opportunity.mention`) carry a
  `titleMessage` in the `crm` bundle (`notifications.*.title`, English and Polish) beside the
  English `title`, so the Admin UI shows each reader their own language and falls back to the
  English sentence while the module is switched off. The params are the opportunity's number
  and, for a mention, the author's name — nothing the sentence does not already say.
- **Board** — `GET /board`: a column per status with count, value totals per currency and the
  first cards.
- **Analytics** (`crm:analytics`) — five live reads under `/analytics/`: handling time, time
  in status, rep effectiveness, top opportunities, average value. Per currency, UTC.
- **Lookups** — `/lookups/organizations`, `/sales-channels`, `/assignees`, `/contacts`,
  `/mentionable`, `/quote-requests`, so the module's pickers need no permission of the modules that own those
  rows.

**Automatic creation**, both off by default: `crm.auto_create_from_orders` (per sales channel)
and `crm.auto_create_from_quote_requests`. A document created from within an opportunity — the
*Create order* and *Create quote request* buttons, carried as an `origin` on the owner's create
request — is linked to that opportunity and gets none of its own.

**An order placed from a linked quote request joins the opportunity by itself**
(`linkSource: "quote_conversion"`), whether the opportunity is open or closed, and such a pair
is counted once in a computed value — the order's figure, not the two added. It relies on the
order recording the quote request it was placed from, which `@endora-commerce/mod-orders` does
from the same release.

**The Admin UI** (`./admin`, `./tailwind.css`): a "CRM" sidebar section with *Opportunities*,
*Board*, *Analytics*, *Tags* and *Workflow*; the create screen and the opportunity's own screen
with *Overview*, *Notes*, *Messages*, *Attachments* and *Change history*; four command-palette
actions (`open-opportunities`, `new-opportunity`, `open-opportunity-board`,
`open-crm-analytics`); and three panels contributed to other modules' screens — *Open
opportunities* on an organization, *Linked opportunity* on an order and on a quote request.
The board moves a card by dragging (mouse, touch, keyboard) or from the card's "Move to…"
menu. English and Polish.

**For other modules.** Events: `crm.opportunity.created.v1`, `…status_changed.v1`,
`…closed.v1` (these three are also offered as outbound webhooks), `…assigned.v1`,
`…document_linked.v1`, and per transition `crm.opportunity.status.from_<x>_to_<y>.before`,
`…from_<x>.before`, `…from_<x>_to_<y>.after`, `…to_<y>.after`. Container names:
`opportunityReadPort`, `opportunityTransitionPort` (both fail closed while the module is off)
and `opportunityTransitionGuardRegistry`, into which a module pushes a guard that may refuse a
move by throwing `OpportunityTransitionVetoError`. The module contributes to the registries of
`sales_channels` (attribution), `assets_library` (an attached file cannot be deleted from the
library), `audit_logs` (recent activity names an opportunity), `custom_fields` (the
`opportunity` host type) and `webhooks`.

The module's documentation page, `docs/crm.md`, describes all of it for an operator and for a
developer.
