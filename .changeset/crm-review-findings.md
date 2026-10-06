---
'@endora-commerce/mod-crm': minor
'@endora-commerce/contracts': patch
---

CRM: the findings of an independent review, fixed before the module's first release.

What another module owns is shown to somebody who may read it there. Linking an
order, and deciding whether it follows the opportunity, needs `orders:read` as
well as `crm:write`; linking a quote request, and the lookup that offers one,
needs `rfqs:handle`. A reader without the owner's permission sees that a
document is linked and nothing of it (`available: false`), is not told which
documents a computed value leaves out, and is shown no name for an order
(`orders:read`) or a product (`catalog:read`) a text mentions.
`GET /documents/:kind/:id/opportunity` asks for the owner's permission too.
Moving an opportunity still moves its followed orders whoever moves it.

An attachment is never a document a browser runs: HTML, SVG, XML and JavaScript
are refused by name or by type, on upload and when attaching a library file
(`415 ASSET_UPLOAD_TYPE_NOT_ALLOWED`), and every link handed out is a download.

A notification names an opportunity by its number only and is written only for
somebody who can reach its organization; an administrator who cannot reach the
organization cannot be made the assignee (`CRM_ASSIGNEE_INVALID`). A failure to
write a notification no longer turns a committed assignment or message into an
error.

The text of a note or a message is not written to the audit trail: an entry
records who wrote, edited or deleted it and how long it was.

An order never reopens a closed opportunity, and an order-caused move that fails
is recorded on the opportunity. Two retries of one refused order change ask the
order once. A status cannot be deleted or re-defined under an opportunity on its
way into it; an opportunity created automatically while the workflow's start
status changes is created in the new start status.

`PATCH /opportunities/:id` answers `400` for an `If-Match` that is not the
version. A date the calendar does not have (`2026-02-31`) answers `400` wherever
one is taken — `calendarDateSchema` in the contracts now checks the day exists.
Filtering by tag no longer reads every tagged opportunity into the request.
