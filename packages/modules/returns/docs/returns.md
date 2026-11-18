---
title: Returns
description: Returns and complaints (RMA) — submission, verification, reverse-logistics shipments and settlement over a configurable status graph
---

# Returns (`returns`)

Returns & complaints (Refunds, RMA). Manages the lifecycle of a return or
complaint case raised against a completed order — submission, verification and
RMA-number assignment, reverse-logistics shipments, and settlement (money
refund, store credit, replacement, or repair) including the corrective invoice.
Mirrors the `orders` module's configurable status-graph workflow.

## Public surface

Admin routes are gated by `returns:read` (read) / `returns:write` (mutations).

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/orders/:orderId/returnable` | customer | Returnable lines + eligibility for an order |
| `POST /api/v1/returns` | customer | Open a return/complaint case — against an order, or a complaint without one (see *Complaints without a platform order*) |
| `GET /api/v1/returns/form-config` | customer | What the form offers: complaints without an order, proof of purchase, the clauses, the file limits |
| `POST /api/v1/returns/uploads` | customer | Upload one file (multipart) before the case is filed (see *Attachments*) |
| `POST /api/v1/returns/:id/attachments` | customer | Add one file (multipart) to a filed case |
| `GET /api/v1/returns/:id/attachments/:attachmentId/file` | customer | Download a file of a case the caller may see |
| `GET /api/v1/returns` | customer | List the caller's cases, or the Organization's (see *Who may open, see and act on a case*) |
| `GET /api/v1/returns/:id` | customer | Case detail (customer-visible comments only) |
| `POST /api/v1/returns/:id/comments` | customer | Reply on a case |
| `POST /api/v1/returns/:id/select-delivery-method` | customer | Choose a return delivery method |
| `POST /api/v1/returns/:id/attachments` | customer | Attach a file to the case |
| `POST /api/v1/returns/:id/cancel` | customer | Withdraw the case |
| `GET /api/v1/returns/reasons` | customer | Active reasons for the storefront form |
| `GET /api/v1/returns/guest/availability` | anonymous | Whether this channel accepts complaints from guests (see *Complaints from guests*) |
| `POST /api/v1/returns/guest/verifications` | anonymous | Send a one-time link to confirm an e-mail address |
| `POST /api/v1/returns/guest/sessions`, `DELETE …/sessions/current` | anonymous | Redeem the link into a guest session / end the session |
| `GET /api/v1/returns/guest/form-config`, `POST …/guest/uploads`, `POST …/guest/cases` | guest session | The guest form's configuration, its file uploads, and filing the complaint |
| `GET /api/v1/returns/track`, `POST …/track/comments`, `POST …/track/attachments`, `GET …/track/attachments/:attachmentId/file` | tracking link | Read the case, reply, add a file, download a file — the token travels in the `X-Returns-Tracking-Token` header |
| `GET /api/v1/admin/returns` | admin | List/filter/search cases + per-status counts |
| `GET /api/v1/admin/returns/export` | admin | CSV export of the current view |
| `POST /api/v1/admin/returns/bulk-transition` | admin | Bulk status change (skips disallowed) |
| `GET /api/v1/admin/returns/:id` | admin | Case detail (incl. internal comments) |
| `POST /api/v1/admin/returns/:id/authorize` | admin | Assign RMA number, advance to `authorized` |
| `POST /api/v1/admin/returns/:id/reject` | admin | Reject with a mandatory reason |
| `POST /api/v1/admin/returns/:id/transition` | admin | Guarded status transition |
| `GET\|POST /api/v1/admin/returns/:id/settlement` | admin | Prefill / execute settlement |
| `POST\|DELETE /api/v1/admin/returns/:id/alternative-consent` | admin | Record / revoke the consumer's consent to a resolution other than a refund (see *Consumer withdrawal*) |
| `GET\|POST /api/v1/admin/returns/:id/comments` | admin | List / add comment (visibility + notify; see *Notifications*) |
| `GET /api/v1/admin/returns/notification-health` | admin | Where the new-case e-mail goes to nobody (see *Notifications*) |
| `GET\|POST /api/v1/admin/returns/:id/shipments` + `/:shipmentId/receive` | admin | Return shipments |
| `GET /api/v1/admin/returns/:id/attachments/:attachmentId/file` | admin | Download a case's file |
| `POST /api/v1/admin/returns/:id/guest/tracking-link` | admin | Send a guest a new tracking link (see *Complaints from guests*) |
| `POST /api/v1/admin/returns/:id/guest/erase` | admin (`returns:erase_personal_data`) | Erase a guest's personal data from a case at once |
| `GET\|POST /api/v1/admin/returns/clauses`, `PATCH\|DELETE …/clauses/:id` | admin | The clauses of the returns form (see *Clauses*) |
| `GET\|POST /api/v1/admin/returns/list-views` | admin | The caller's own saved views plus every shared one / save a view |
| `PATCH\|DELETE /api/v1/admin/returns/list-views/:id` | admin | Change / delete a saved view (owner, or a platform admin for a shared one) |
| `…/statuses`, `…/transitions`, `…/reasons`, `…/delivery-methods` | admin | Configuration |

## Who may open, see and act on a case

On the storefront a buyer's reach follows their organization role. This module
declares two organization permissions, which an Organization's administrator
grants per role:

| Permission | Code | *Member* holds it |
| --- | --- | --- |
| **Create returns and complaints** | `returns.create` | yes (member default) |
| **View the organization's returns and complaints** | `returns.view_organization` | no |

*Administrator* holds both, as it holds every permission. One code covers returns
and complaints alike: they are one form and one route.

- **Opening a case** (`POST /api/v1/returns`) needs `returns.create`. Without it
  the request is refused `403 ORGANIZATION_PERMISSION_REQUIRED`, naming the
  permission, before the order is read; nothing is created.
- **Which orders a case may be opened for**: any order the buyer may read — the
  orders they placed, and a colleague's order when their role holds the `orders`
  module's **View the organization's orders** (`orders.view_organization`). The
  rule is the `orders` module's, through `OrderReadPort.findByIdForCustomer`, so
  it matches the order list. An order out of reach answers `404` to the
  returnable-lines read and to the submission alike. A case opened from a
  colleague's order is filed in the name of the member who opened it: its
  e-mails go to them, and the colleague who placed the order sees the case only
  with `returns.view_organization`.
- **Seeing cases** (`GET /api/v1/returns`, `GET /api/v1/returns/:id`): the cases
  the buyer filed, or — with `returns.view_organization` — every case of their
  Organization, and of its subtree for a head-office login with roll-up enabled.
  Roll-up widens the reach; it never grants the permission. A case out of reach
  answers `404`, never `403`. Each case in the list carries `customerAccountId`,
  the member who filed it.
- **Acting on a case** — commenting, attaching files, choosing the return
  delivery method and cancelling — stays with the member who filed it, whatever
  anyone else's permissions; to anyone else these requests answer `404`. None of
  them needs `returns.create`, so a member whose role loses it can still follow
  up the cases they already filed. Reading an order's returnable lines needs no
  permission either.

Before organization roles, every buyer — administrators included — saw and
opened cases for the orders they placed only. *Member* keeps exactly that; an
administrator now sees every case of the Organization and may open a case from a
colleague's order.

On the storefront:

- **Returns** (`/returns`) lists the cases the member may see. A colleague's case
  is marked *Filed by a colleague*. **Start a new return** is offered only to a
  member whose role holds `returns.create`; the order page offers its return or
  complaint entry on the same rule.
- Without `returns.create`, the new-case page (`/returns/new`) says so instead of
  showing the form: *"Your role does not include the “Create returns and
  complaints” permission, so you can't start a return or a complaint. Ask your
  organization's administrator if you need it."*
- A colleague's case opens read-only. The page offers no comment box,
  attachment upload, return delivery choice or cancel button, and says why in
  one line: *"This case was filed by a colleague. You can read it, but only they
  can add messages or change it."* The filer's messages are labelled
  *Colleague*, not *You*.

When the module is switched off, both permissions leave the Organization's
permission catalogue and every member's effective permissions; a role's stored
grant is kept and applies again when the module is switched back on.

## Status machine (configurable)

The case lifecycle is **admin-configurable** (`return_statuses` +
`return_status_transitions`, seeded on install). Defaults:

- **new** (initial) → **authorized** → **received** → **resolved** → **closed** (terminal)
- **rejected** (terminal) reachable from new/authorized/received; **cancelled** (terminal) from new/authorized.

Transitions are enforced; the initial status is immutable; terminal statuses
have no outgoing edges. Each transition emits templated `return.status.*`
before/after events and is written to the audit log — whether it had a reason
(`hasReason`), never the reason's text.

## Notifications

Every e-mail below is a transactional e-mail an operator edits, and may switch
off, under **Transactional emails** (group *returns*), shipped in English and
Polish. Each is sent in the language of the case's sales channel and names the
case by its **reference**: the RMA number once there is one, and until then `#`
followed by the first eight characters of the case id (`#3F9A21C0`). The same
reference is the case's link text in the admin list and its title on the detail
page, and the admin search finds a case by it, with or without the `#`.

| E-mail | Sent to | When |
| --- | --- | --- |
| *New return or complaint* (`return_new_case`) | the addresses in **New-case recipients** | a case is filed |
| *Return or complaint received* (`return_submitted`) | the customer who filed the case | a case is filed |
| *Message on a return or complaint* (`return_comment_added`) | the customer who filed the case | an operator posts a customer-visible comment with *Notify customer by e-mail* |
| *Return or complaint status changed* (`return_status_entered`) | the customer who filed the case | the case enters a status marked *E-mail customer on entry* |

- **New-case recipients** — the setting `returns.new_case_recipients` on
  **Settings → Returns**, globally or per sales channel (a channel's list
  replaces the global one). Up to 10 addresses are used. An entry that is not an
  e-mail address is skipped when the e-mail is sent and reported in the log as
  `invalid_recipient`; the other addresses still receive it. While no address is
  configured for a channel, the **Returns → Workflow** page shows a warning that
  links to the setting.
- **Confirmation** — goes to the account that filed the case, also when the
  order was placed by a colleague.
- **Comments** — a new comment is internal until the operator ticks *Visible to
  customer*. *Notify customer by e-mail* is available only for a visible comment,
  and the API refuses it on an internal one (422 `VALIDATION_FAILED`, detail
  `notify_requires_customer_visible`). A comment posted with it shows *E-mail
  requested* in the thread. Comments posted before this release are never sent.
- **Status e-mails** — mark a status *E-mail customer on entry* in the
  **E-mail customer on entry** column of **Returns → Workflow**. The e-mail is sent
  when an operator or the platform (for example, receiving a return shipment)
  moves a case into that status; never when the customer moves it themselves
  (cancelling their case), and never when a case is filed — the confirmation covers
  that, so marking the initial status only acts on a later transition into it.
  Marking a status sends nothing for the cases already in it. *Authorized* and
  *Rejected* cannot be marked: they send their own e-mail, so a customer gets one
  e-mail per transition.
- **Admin bell** — every active administrator who may view returns
  (`returns:read`) gets one bell entry per new case, naming its kind, reference and
  filing date and linking to it. The entry names no customer or organization.
  While **Admin notifications** is switched off no entry is recorded and nothing
  else changes.
- **Guests** — a case filed by a guest (see *Complaints from guests*) gets its own
  e-mails, sent to the verified address and carrying the case's private tracking
  link instead of a link into an account:

  | E-mail | When |
  | --- | --- |
  | *Confirm the e-mail address of a guest complaint* (`return_guest_verification`) | a guest asks for a link to the complaint form |
  | *Complaint received (to a guest)* (`return_guest_submitted`) | a guest files a case |
  | *Message on a complaint (to a guest)* (`return_guest_comment_added`) | an operator posts a visible comment with *Notify customer by e-mail* |
  | *Complaint status changed (to a guest)* (`return_guest_status_entered`) | the case enters a status marked *E-mail customer on entry* |
  | *Complaint authorized (to a guest)* (`return_guest_authorized`) | the case is authorized |
  | *Complaint rejected (to a guest)* (`return_guest_rejected`) | the case is rejected, with the reason |
  | *New tracking link for a complaint (to a guest)* (`return_guest_link_reissued`) | an operator sends a new tracking link |

  The verification and the confirmation **cannot be switched off**: the first is the only
  way a guest can start a complaint, the second the guest's only lasting way back to
  the case. So a guest's confirmation goes out even while `return_submitted` is off for
  account holders. The others follow the same switches as their account versions. The
  *New return or complaint* e-mail to the shop names a guest as `{name} (guest)` and
  no organization; the bell entry for a guest case goes only to administrators who may
  see guest cases. Once a guest's personal data is erased, nothing more is sent to them.
- **Delivery** — the e-mails and the bell entries are sent from the
  `returns-notifications` queue after the action that triggered them was saved, so
  they never slow down, fail or undo it. A failed send is retried; a message that
  went out is not sent again. An e-mail that is not sent — switched off, no
  recipient, no mail server — is recorded with its reason in the log.

## Who authorized a case

Entering *Authorized* — through **Authorize**, the status buttons on the case, or
the bulk action on the list — assigns the RMA number, records the time and records
the administrator who did it. The case detail shows it on the *Case* card as
`{time} by {name}`; the list has a non-sortable **Authorized by** column, and the
CSV export carries `reference` and `authorizedBy`.

- An administrator whose account no longer exists is shown as *former
  administrator*.
- Cases authorized before this release were filled in from the audit log when the
  release was installed. Where the audit log names nobody, the authorizer is shown
  as *unknown*.

## Complaints without a platform order

A shop can accept complaints about goods the customer bought elsewhere — in a
physical store, from a distributor, on another marketplace. Switch on
**Complaints without a platform order** (`returns.off_platform_complaints_enabled`)
on **Settings → Returns**, globally or per sales channel. It is off by default.

- **On the storefront** — *Start a return or complaint* offers, above the list of
  orders, *Bought it somewhere else? File a complaint without an order*. A customer
  with no orders gets it as the main action. The form asks for the product (up to
  five, each with a quantity, reason and description, optionally a serial number, and
  its own defect photos); the customer adds and removes products on the form. The
  product does not have to be in the catalogue — a product no longer sold is filed by
  its model name. The product field searches the shop's catalogue and also takes a typed
  model name: a product chosen from the suggestions is checked against the sales
  channel and its name copied to the case; without JavaScript the field takes the
  model name only. A chosen product the channel does not sell is refused on that
  line, with the name kept for resubmitting as a typed model. The form also asks for
  the purchase date, an optional receipt or invoice number, the proof of purchase and
  other documents, the contact details and the address the
  product should go back to. Contact and address are prefilled from the account and
  its delivery address; changing them on the form changes neither. The form works
  without JavaScript.
- **Proof of purchase** — with **Proof of purchase required**
  (`returns.proof_of_purchase_required`) a complaint without an order is accepted
  only with a file typed *Proof of purchase*. It has no effect on order cases.
- **Switching it off** — new complaints without an order are refused
  (`403 RETURN_OFF_PLATFORM_DISABLED`); the ones already filed stay and are
  handled as before.
- **The case** — it is always a complaint, with no order and no amounts. The admin
  list marks it *Bought elsewhere* and can filter by **Origin**; the detail shows the
  purchase, the contact and the return address as the customer gave them.
- **Submitting twice** — the form carries a submission key, so submitting it again
  (a double click, the browser's back button) returns the case already filed.

## Complaints from guests

A shop that accepts complaints without a platform order can also accept them from
people **with no customer account** — someone who bought the product in a physical store
or from a distributor and has never registered. Switch on **Complaints from guests**
(`returns.guest_complaints_enabled`) on **Settings → Returns**, globally or per sales
channel. It is off by default, and it takes effect only while **Complaints without a
platform order** is on for the same channel: with that off, no guest option appears
anywhere and a guest submission is refused (`403 RETURN_GUEST_COMPLAINTS_DISABLED`).

- **On the storefront** — a signed-out visitor who opens the returns area or the
  *bought elsewhere* form is offered *Sign in* (which brings them back to the same page)
  or *Continue without an account*. With the setting off they are sent to sign in, as
  before.
- **Confirming the e-mail address** — the guest enters an e-mail address and gets a
  one-time link, valid for 60 minutes. The page answers in the same words whatever the
  address, so it never reveals whether an address has an account; when it has one, the
  e-mail itself (seen only by the address's owner) adds that complaints filed after
  signing in appear in the account. A newer link replaces the previous one. Requests are
  limited per address and per client, without saying so to the visitor. Opening the
  link shows a *Continue* page; only the click redeems the link, so an e-mail scanner
  that opens links cannot use it up.
- **The guest session** — the click starts a guest session of 24 hours on that sales
  channel, held in a browser cookie. A link that no longer works shows a page offering a
  new one, with the address filled in only when the same browser asked for the link;
  while the browser still holds a live guest session it simply continues to the form.
- **The form** — the *bought elsewhere* form, with its rules unchanged: products, purchase
  data, proof of purchase, clauses and files. The e-mail address is the verified one and
  cannot be changed; name, phone and return address are typed by the guest, nothing is
  prefilled. A guest files complaints only — never a return, and never against a platform
  order. Up to 5 cases per session and 10 per address in 24 hours.
- **The case** — it has **no customer account and no organization**, and it is never
  attached to an account, even when its e-mail address matches one or the guest is
  signed in while filing. A customer whose address it carries does not see it in their
  account.
- **The tracking link** — the success page and every e-mail to the guest carry a private
  link to a page showing the case: its status, the rejection reason if any, the products,
  the purchase, the contact details and address as given, the visible comments and the
  files. **Anyone holding the link can see the case**, and the page says so. While the case
  is open the guest replies and adds files there (up to 20 comments per case in 24 hours);
  once it is closed the page is read-only. The link stops working **90 days after the case
  closes**, when the guest's data is erased, or when it is replaced; a link that does not
  work shows one neutral page that does not say whether the case exists.
- **Sending a new tracking link** — on the case page, *Guest data → Send a new tracking
  link* (with `returns:write`) sends a new link to the verified address and stops the
  old one at once. Use it
  when a guest has lost the link or shared it by mistake. Changing the platform's session
  secret (`SESSION_COOKIE_SECRET`) voids every guest link at once; send new links to the
  guests whose cases are still open.
- **Who sees guest cases** — only administrators who may see every organization's cases.
  An administrator restricted to some organizations, and a sales representative, do not
  find guest cases in the list, its counts, the search, the export or the saved views, and
  opening one by its address answers *not found*. In the list a guest case is marked
  *Guest*, and the **Origin** filter offers *Bought elsewhere – guest* and *Bought
  elsewhere – customer* beside *Platform order* and *Bought elsewhere*. The search finds guest cases by the exact
  contact e-mail address. The CSV export carries a `guest` column. On the case page the
  contact card shows *Verified e-mail*, how long the tracking link is valid and when the
  personal data will be erased; a guest's comments are labelled *Guest*.
- **Settling** — like any complaint without a platform order: *Replacement*, *Repair* or
  *Settled outside the platform* (see *Settling an off-platform case*).

### Erasing a guest's personal data

A guest has no account to delete, so the platform erases the guest's contact details,
return address and files from the case a set time after it **closes** — after it enters a
final status (*Closed*, *Rejected* or *Cancelled*). The period is **Guest data retention
(days)** (`returns.guest_data_retention_days`), 90 by default; a value below 30 is read as
30 and above 3650 as 3650. The products, purchase data, statuses, comments and the
resolution stay for the shop's records; the case shows when its data was erased, and its
tracking link stops working.

- **Close settled cases.** The period runs from closing, not from settling: a case left
  in *Resolved* keeps the guest's data indefinitely. Reopening a closed case postpones the
  erasure to the period after it next closes.
- **On request** — when a guest asks for their data to be erased earlier, find their
  cases by searching the list for the e-mail address, then choose *Guest data → Erase
  personal data* on each and confirm. It works in any status, cannot be undone, and no
  further e-mail is sent to the guest. It needs the permission **Erase personal data of
  guest returns and complaints** (`returns:erase_personal_data`, which requires
  `returns:read`); grant it under **Admin roles** to whoever handles data-subject
  requests.
- **Module switched off** — the daily `returns-maintenance` pass does not run while
  `returns` is off, so an erasure that falls due then is postponed; it runs at the first
  pass after the module is back on.
- **Anonymising a customer account does not touch guest cases** that carry the same
  e-mail address: they are not that account's. Erase them separately, as above.
- **Verification records** — the addresses entered on the storefront are deleted 7 days
  after they were requested, whether or not a case was filed.

## Attachments

A customer attaches files to a case: photos, a proof of purchase and other
documents. JPEG, PNG, WebP or PDF, up to 10 MB each, up to 30 MB per submission
and 10 files per case. The type is checked from the file's content, not its name.

- **Uploading** — a file is uploaded first (`POST /api/v1/returns/uploads`) and
  then filed with the case (`attachments: [{ uploadId }]`); a file uploaded and
  never filed is deleted after 24 hours. After filing, the customer adds files on
  the case page (`POST /api/v1/returns/:id/attachments`). A refused file is answered
  `422 RETURN_ATTACHMENT_REJECTED` with the reason.
- **A file of one product** — a defect photo can belong to one line of the case:
  send `attachments: [{ uploadId, line }]`, where `line` is the line's position in
  the request's `lines` (from 0), or `returnCaseItemId` with a file added later. A
  line the case does not have is refused with the reason `unknown_line`. A file
  without a line belongs to the whole case; the administration case page shows a
  line's files beside that product and the rest under *Attachments*.
- **Who sees them** — the files are stored privately: only the customer who filed
  the case, a colleague who may see the Organization's cases, and administrators
  holding `returns:read` download them. They are served for download, never
  rendered in the shop's own pages.
- **A guest's files** — a guest uploads files within the guest session before filing,
  and through the tracking link afterwards, with the same types and limits. Only the
  tracking link of that case and the administrators who may see guest cases download
  them; a file uploaded in one guest session cannot be filed by another session or by a
  customer. A guest's files are erased with the guest's personal data.
- **Changed in this release** — `attachmentAssetIds` on `POST /api/v1/returns` and
  the JSON `{ assetId }` body on `POST /api/v1/returns/:id/attachments` are gone:
  upload the file, then send `attachments: [{ uploadId }]`, or post the file as
  multipart to `/:id/attachments`. The old calls linked any asset id without
  checking it and nothing displayed the link. Attachments recorded the old way stay
  in the database, typed *Other*, but are not listed on the case and cannot be
  downloaded.

## Clauses

**Returns → Terms** (also in the command palette) holds the clauses the returns form shows: a label, a text and
optionally a link to the full terms, per language, for returns, complaints or both,
on every sales channel or one. A clause is either *Must be accepted* — the customer
ticks it, and the case is refused without it — or *Information only*.

- A case stores the clauses shown with it, in the language shown, with the time
  they were accepted; the admin detail shows them under *Terms shown*.
- Changing a clause's text or link starts a new revision. A customer who submits
  while the terms changed is asked to read and accept them again
  (`422 RETURN_CLAUSES_NOT_ACCEPTED`).
- The label and the text are required in the default language. The customer sees
  them in their language, falling back to the default one.

## Settling an off-platform case

A complaint without a platform order has no payment to refund and no invoice to
correct. **Settle** offers *Replacement*, *Repair* and *Settled outside the
platform* — the last for a complaint the shop resolved some other way (a refund in
store, a voucher). It needs a note saying how, which only staff see. Refund, store
credit and a corrective invoice are refused
(`422 RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM`). *Settled outside the platform*
moves the case to *Resolved* from any open status.

## Erasing personal data

When a customer account is anonymised, its cases keep their lines, purchase data
and comments, and lose the contact details, the return address and every file. A
case shows when this happened. If `returns` was switched off at that moment, the
daily `returns-maintenance` pass catches up once it is back on. Guest cases carrying
the same e-mail address are not the account's and are not touched; see *Erasing a
guest's personal data*.

## Key behaviours

- **Eligibility & free-return window** — a case is allowed once the order
  reaches its fulfilment-completing status; the free-return window
  (`returns.free_return_days`, default **14**, the statutory withdrawal period
  of Directive 2011/83 art. 9) is counted from that moment and governs who
  bears the return shipping cost. The moment is the order's completion as
  `orders` records it (`orders.completed_at`), which a later edit of the order
  does not move; in earlier releases it was the order's last edit. See *Counting the
  windows* below.
- **RMA numbering** — `${prefix}${sequence}${suffix}` from
  `returns.rma_number_prefix` / `returns.rma_number_suffix`, assigned on
  authorization, unique and never reused.
- **Partial / repeat returns** — per-line quantity up to the remaining
  returnable amount, excluding quantities already covered by non-rejected /
  non-cancelled cases.
- **Settlement** — per-line refund defaults to the amount paid for the returned
  quantity and may never exceed it. For an order placed under the per-rate VAT
  method that amount is the drop in the value of the goods the buyer keeps: what
  was left paid less what the kept goods are worth after the return (VAT per
  rate on the kept nets, less the discount they carry), so it can differ by a
  cent from the returned units' own value and the order's returns together still
  refund exactly what was paid. Resolutions: refund (money), credit (tops up
  the organization's `credit_limits` grant), replacement, or repair; a consumer
  withdrawal settles as a refund unless the consumer's consent to another
  resolution is on record (see *Consumer withdrawal*). A corrective
  invoice (`invoices` kind `correction`) is requested for money/credit settlements.
  An order that was never invoiced has no VAT document to correct, so none is
  issued: the settlement succeeds, the refund is recorded on the return case and
  the payment record, and the result states `correctiveInvoice: { issued: false,
  reason: "order_not_invoiced" }`. The invoice issued later lists only what the
  buyer kept: a return settled with a refund or a credit takes its quantity off
  the order line, a line returned in full is left off, and the discount the
  returned goods carried comes off the invoice's discount line. What was
  withheld — the default less the approved amount — is invoiced as part of the goods' price at the line's VAT
  rate (see *Invoices*). On an order that was
  invoiced, a return's correction credits the returned goods and leaves on the
  invoice the VAT per rate on the nets the buyer kept.
- **A complaint refund is a price reduction** — a complaint settled with a
  refund or a credit leaves the goods with the buyer, so on an invoiced order
  its correction credits the approved amount at the line's VAT rate as a price
  reduction: quantity 0, no share of the order discount, and no effect on the
  quantity a later return of the line is credited from. A complaint resolved by
  replacement or repair issues no correction. A complaint refunded before the
  order was invoiced currently shows on the invoice as amount due.
- **The default refund is recomputed at settlement** — the figure a case shows
  when it is opened is provisional. The settlement recomputes it, one
  settlement of an order at a time, from the cases settled by then. Only a
  return settled with a refund or a credit takes goods off what the buyer
  keeps; a rejected, replaced or repaired case and every complaint take nothing
  off. So the figure can move by a cent or two when cases are settled in a
  different order from the one they were opened in, or after an earlier case
  was rejected. The settlement form shows the recomputed figure. An approved
  amount equal to a default the case showed settles at the recomputed default,
  a lower amount is kept as typed, and a higher one is refused with
  `422 RETURN_REFUND_EXCEEDS_PAID` with nothing written:
  reload the form and confirm. The `return.settled` audit entry names the
  lines whose default moved (`recomputedDefaultItemIds`), not the amounts.
- **No line refunds more than it was paid** — a complaint refund counts against
  the line it names, and the unabsorbed part of it counts against what is left
  paid for the order: once a return of the line has been cut by the complaint,
  that amount is not counted twice. A later
  return of that line still gets its full default, until the line's refunds,
  the complaint included, reach what the line was paid; from then on the
  case shows, and the settlement form offers, at most what is left of it, and
  the audit entry names the line the bound held (`ceilingBoundItemIds`). The platform cannot tell which unit came
  back. Before settling a return, check the order's other cases for an earlier
  complaint on the same line: if the defective unit the complaint compensated
  is the one coming back, lower the amount by hand.
- **A consumer's withdrawal refunds the delivery and the payment surcharge**
  (Directive 2011/83/EU art. 13(1), Polish Consumer Rights Act art. 32 ust. 1).
  The case that brings back the last returned unit of a B2C order (the order's
  organization is a personal one) refunds the order's delivery cost and payment
  surcharge as well as the goods. All of these must hold:
  - the case is a return, not a complaint;
  - with this case, every unit of every order line has come back in a return
    settled with a refund or a credit. An order with a line that could not be
    returned can never be withdrawn in full, so it never refunds them;
  - the case is settled as a refund or a credit. A replacement or a repair
    refunds neither charge, and an amount above 0 sent for one is refused.

  A partial withdrawal refunds neither charge, and the settlement form does not
  offer them. The settlement form shows a *Delivery cost* row and a *Payment
  surcharge* row, each with what was paid as its maximum. The row is filled in
  with the full amount when the case was opened within the withdrawal window:
  14 days from the order's completion, or the channel's
  `returns.free_return_days` when that is longer. A channel set to `0` still
  has the 14 days. Outside the window the row starts at 0 and you may raise it
  to what was paid. Lower the delivery to the price of the cheapest standard
  delivery when the customer chose a more expensive one (art. 13(2)). An amount
  above what was paid is refused with `422 RETURN_REFUND_EXCEEDS_PAID`
  (`details.code` `delivery` or `surcharge`). Through the API, `deliveryRefundAmount` and
  `surchargeRefundAmount` work differently from the line amounts. When you
  leave one out, it settles at the default recomputed at settlement. When you
  send one, it settles at exactly that amount, `0` included, as long as it is
  not above the maximum. A figure the case showed when it was opened can be
  above the maximum by then, and is refused. The settlement form sends only an
  amount you changed. The case's `totalRefundAmount` then includes the
  charges, so it is more than the sum of the lines. The case detail reports
  them as `chargeRefunds`, and the `return.settled` audit entry names the
  charges that were refunded (`refundedCharges`), not the amounts. A business customer's
  return and every complaint are unchanged.

  On an invoiced order, the correction credits the delivery and the surcharge on
  lines of their own, at the VAT rate the invoice charged them at (0 % today).
  When everything came back and was refunded, the invoice nets to zero. On an
  order not invoiced yet, the invoice issued later charges only what is left of
  each charge, and leaves a line out when nothing is left. So a premium delivery
  reduced to the standard price is invoiced alone for the difference. When
  everything was refunded, there is no sale left and the invoice is refused.

  Cases settled before this behaviour existed are not changed. To find B2C
  orders that were returned in full without a delivery refund, see the upgrade
  guide.
- **A switched-off payment gateway refuses the settlement**.
  Money resolutions on a gateway-paid order call the PSP module that took the
  payment; when an operator has that module switched off — or the deployment
  does not offer it — the settlement answers `503 MODULE_DISABLED` naming the
  module, with `Retry-After`. Nothing moves: the case keeps its status, no
  `refunds` row is written, no corrective invoice is issued and no customer
  e-mail goes out. Switching the module back on is the whole remedy. This is
  distinct from a deployment that has **no** PSP refund integration at all,
  which still settles as `pending_manual` for a person to pay out by hand —
  there is nothing there to switch on.
- **Saved views on the Returns list** — the *Saved views* control above the
  list stores its status, kind and RMA-number filters and its sort (the list
  has no column picker), privately or shared with every admin who can open the
  list. The four `list-views` routes are gated by `returns:read` and follow the
  same rules as the order, product and quote request lists' saved views: names
  are trimmed, 1–160 characters, without control or format characters; one
  admin cannot hold two views whose names differ only by case or surrounding
  spaces (`409 RETURN_SAVED_VIEW_NAME_TAKEN`); `filters` is capped at 8 KB,
  `visibleColumns` at 64 entries of 64 characters and `sort.field` at 64
  characters; `shared` and `sort` are required on create. Another admin's
  private view and an id that is not a UUID both answer `404`; a shared view
  is changed or deleted by its owner or by an admin whose access is not
  restricted to a set of organizations (`403` otherwise). List items carry
  `ownedByCaller` and `canModify`, and `DELETE` answers `{ data: { deleted:
  <id> } }`. Views saved before these rules keep their names as stored —
  including blank names and duplicates — until their owner renames or deletes
  them; a change that leaves the name alone is never refused for it.

## Refusals

Each refusal below has its own code and a sentence in English and Polish,
which names the values in `details`. The buyer reads it in the language the
storefront asked for, the operator in their own. Until issue #625 they were
`VALIDATION_FAILED`, most with the reason in `details.code`; the status is
unchanged. The status code travels as `details.statusCode`, because
`details.code` is the slot for a refusal's token.

| Code | Status | When | `details` |
| --- | --- | --- | --- |
| `RETURN_ORDER_NOT_ELIGIBLE` | `422` | `POST /api/v1/returns` — the order is not completed yet | `orderId` |
| `RETURN_QUANTITY_EXCEEDS_RETURNABLE` | `422` | `POST /api/v1/returns` — a line asks for more than it can still return | `orderItemId`, `requested`, `remaining` |
| `RETURN_REASON_INACTIVE` | `422` | `POST /api/v1/returns` — the reason was switched off (an order's case or a complaint without an order) | `reasonId` |
| `RETURN_COMMENTS_CLOSED` | `409` | a comment on a case in a terminal status | `returnCaseId`, `statusCode` |
| `RETURN_CASE_CLOSED` | `409` | `POST /api/v1/returns/:id/select-delivery-method`, `POST /api/v1/returns/:id/attachments` or `POST /api/v1/returns/track/attachments` on a case in a terminal status | `returnCaseId`, `statusCode` |
| `RETURN_DELIVERY_METHOD_UNAVAILABLE` | `422` | the same route — the return delivery method is not offered | `returnDeliveryMethodId` |
| `RETURN_SETTLEMENT_IN_PROGRESS` | `409` | `POST /api/v1/admin/returns/:id/settlement` — another return of the order is being settled; try again | `orderId` |
| `RETURN_REFUND_EXCEEDS_PAID` | `422` | the same route — a refund above what may be refunded, for a line or, with `code` `delivery` / `surcharge`, a charge | `returnCaseItemId` (a line), `requested`, `maximum`, `currency` |
| `RETURN_REFUND_GATEWAY_FAILED` | `502` | the same route — the payment gateway refused the refund; nothing is settled | `settlementState`, `failureReason` (the gateway's words), `providerDetails` |
| `RETURN_STATUS_CODE_TAKEN` | `409` | `POST /api/v1/admin/returns/statuses` — another status has the code | `statusCode` |
| `RETURN_STATUS_TERMINAL_HAS_TRANSITIONS` | `409` / `422` | marking a status with outgoing transitions terminal (`code` `mark_terminal`), or a transition from a terminal status in `PUT …/transitions` (`code` `add_transition`) | `statusCode`, and `outgoingCount` or `toStatusCode` |
| `RETURN_STATUS_NOT_DELETABLE` | `409` | deleting the initial status (`code` `initial`) | `statusCode` |
| `RETURN_STATUS_IN_USE` | `409` | deleting a status cases are in | `statusCode`, `caseCount` |

Amounts are two-decimal strings. An unknown order line or return line, an
unknown reason id, a missing refund payment method, a blank rejection reason
and a transition naming a status that does not exist stay `VALIDATION_FAILED`.

## Counting the windows

Both windows this module judges — the channel's free-return window and the
consumer's statutory withdrawal period — count from the same moment: when the
order entered its fulfilment-completing status (`completingStatusEnteredAt`,
from `OrderReturnContextPort`). An order that has not been completed has not
started either period. The platform has no delivery date (a shipment's success
is the carrier accepting the parcel, which is earlier than the consumer
receiving it), so the operator completing the order is the closest fact there
is; the Orders page asks operators to complete an order when the goods have
been delivered. This module does not read Shipments for it, so switching
Shipments off changes nothing about either window.

- **Calendar days in `returns.time_zone`.** A period of *n* days ends at the end
  of the *n*-th calendar day after the day of completion, in the zone the
  setting names (an IANA name, default `Europe/Warsaw`, settable per sales
  channel; a zone the runtime does not know is refused). The day of completion
  itself is not counted.
- **Weekends.** A last day on a Saturday or Sunday moves to the following
  Monday. Public holidays are not modelled: there is no holiday calendar.
- **The statutory period** is 14 days, whatever `returns.free_return_days` says
  — a channel set to `0` or to fewer days cannot shorten it.
- **A 7-day grace.** An operator may complete an order before the parcel
  arrives, so the consumer's withdrawal stays possible for 7 calendar days after
  the later of the statutory end and the channel's free-return window. A
  withdrawal made in the grace is accepted and marked as outside the statutory
  period, for the operator to judge.

In earlier releases the free-return window ended exactly `free_return_days × 24 h`
after the order's last edit. It now ends up to a day later (up to three over a
weekend), never earlier. The statutory period and the grace are computed by
`domain/withdrawal-period.ts`; the withdrawal function that uses them arrives in
a later release.

## Consumer withdrawal

A consumer who buys at a distance may withdraw from the contract within the
statutory period without giving a reason, and is then reimbursed by the same
means of payment unless they expressly agree otherwise (Directive 2011/83
art. 9 and 13(1); in Poland, art. 27 and 32 of the *ustawa o prawach
konsumenta*). This module tells such a case apart from any other return and
settles it accordingly.

- **Which case is a consumer withdrawal.** A `return` (never a complaint) by a
  **personal** Organization (the one every consumer gets at checkout; never a
  company), filed while the withdrawal is still possible for the order: the
  statutory 14 days, the channel's longer free-return window, and the 7-day grace
  after both (see *Counting the windows*). The answer is fixed when the case is filed and the
  case detail reports it as `consumerWithdrawal`; the admin case view marks the
  case **Consumer withdrawal**. A personal Organization's return filed after the
  grace is a commercial return under the shop's own policy, and nothing below
  applies to it. *Personal* is judged at the moment the order was placed: an
  order placed while the Organization was personal stays a consumer's after an
  operator converts that Organization to a company. A sole trader buying through a company Organization may have
  the same right under Polish law (art. 38a); the platform cannot tell, so an
  operator handles such a case by hand.
- **Cases filed before this release** carry no answer (`consumerWithdrawal:
  null`) and are treated as ordinary returns. Classifying them needs the
  Organization, which a migration may not read, so a later release classifies
  the open ones in the background.
- **A refund by default.** The settlement form starts on **Refund money**, to
  the order's own payment method (`defaultRefundPaymentMethodId` in the
  settlement prefill). The method is chosen by name from the shop's payment
  methods, with the order's own listed first and marked; when that list
  cannot be read, the form falls back to a field for the method's id. Credit,
  replacement and repair stay visible but cannot be chosen until the
  consumer's consent is on record, and the settlement refuses them with
  `422 RETURN_ALTERNATIVE_RESOLUTION_CONSENT_REQUIRED` (`details.resolution`
  names the one refused). The prefill names them in `consentRequiredFor` and keeps
  every resolution in `resolutionOptions`. Company returns and complaints are
  unaffected.
- **Another payment method warns, and does not refuse.** A cash-on-delivery
  order cannot be refunded "by the same means", and a bank transfer is the
  accepted practice there. The form shows a warning, the settlement goes
  through, and its audit entry (`return.settled`) records
  `consumerWithdrawal: true` and `refundMethodDiffers: true`.
- **Recording the consumer's consent.** The consent normally reaches the shop by
  e-mail or telephone. An operator with `returns:write` records it in the
  **Consumer withdrawal** panel of the case: what the consumer agreed to
  (credit, a replacement or a repair), when (not in the future, not before the
  case was filed), and an evidence note of up to 2000 characters, for example
  *"Customer's e-mail of 10 Nov 2026, ticket #123"*. The settlement then accepts
  that resolution, and still refuses the other two. Recording it again replaces
  the earlier one. **Revoke consent** removes it after a confirmation, which
  says what is lost: the evidence note is deleted, while the history keeps that
  the consent was recorded and revoked. Both are audited
  (`return_case.alternative_consent.record` and `.revoke`) with the operator as
  the actor; the entry holds the resolution, the moment and the source, not the
  evidence note, which stays on the case. Once the case is settled its consent
  is frozen: both answer `409` (`details.code: 'consent_frozen'`). A case in a
  **terminal status** of the configured workflow (`rejected`, `cancelled`, or
  any status an operator marked terminal) can never be settled, so its consent
  is closed too: both answer `409` (`details.code: 'case_closed'`), nothing is
  written, and the panel shows the consent on record read-only, with no
  actions. The time the consent was given is shown in the operator's browser
  time zone, which is named beside it. A case that is
  not a consumer withdrawal answers `422` (`details.code:
  'not_consumer_withdrawal'`).
- **Personal data.** The withdrawal statement this module will store keeps the
  consumer's name and e-mail address in two columns of their own, which can be
  cleared while the statement itself is kept as the shop's evidence.

The withdrawal function on the storefront (art. 11a, inserted by Directive (EU)
2023/2673 and applicable from 19 June 2026), the acknowledgement e-mail and the
14-day reimbursement deadline arrive in later releases.

## Returnable products

Whether a line may be returned is decided by the product's **Returnable** flag
as it stood when the order was placed — the Orders module records it on each
order line at placement, and later changes to the product do not reach orders
already placed. The flag is set on the product in the catalogue (the Catalog
module's page describes it, including how to set it for many products at once
through **Bulk edit**).

- **Per-line answer.** `GET /api/v1/orders/:orderId/returnable` gives each line
  `returnable` (always present) and, for a line that may not be returned,
  `notReturnableReason: 'product_not_returnable'`. A line of an order placed
  before the flag was recorded carries no recorded value and **counts as
  returnable**.
- **`eligible` answers for return-kind cases only.** The order-level verdict
  is, in this order of precedence: `order_not_completing`, `fully_returned`,
  then `no_returnable_lines`. `eligible: false` with
  `reason: 'no_returnable_lines'` means the order still has quantities left
  but none of them on a returnable line: **no return can be opened, but a
  complaint still can.**
- **A return naming a non-returnable line is refused.** `POST /api/v1/returns`
  with `kind: 'return'` answers `422 RETURN_LINE_NOT_RETURNABLE` when any
  requested line was recorded as not returnable, with `details.productName`
  (the first such line), `details.orderItemIds[]` and `details.lines[]`
  (`orderItemId`, `productName`) naming every such line. Nothing is written.
- **Complaints are never restricted** by the flag: a `complaint` may name any
  line of the order. **Nothing is refunded for a non-returnable line by
  default**: such a complaint line is stored with an approved refund of `0`,
  while its default refund stays the amount paid — the most the operator may
  approve. The admin case view marks the line **Not returnable at purchase**
  and the settlement form starts from `0` for it, so a refund or credit for it
  happens only when the operator enters an amount. The case detail gives each
  line `returnableAtPurchase` (`true`, `false`, or `null` for a line placed
  before the value was recorded).
- **Duplicate lines are summed.** When a request names one order line more
  than once, the quantities are added up per order line and that total is
  checked against the line's remaining quantity, for both kinds; a total above
  it is refused with `422 RETURN_QUANTITY_EXCEEDS_RETURNABLE`. The entries
  are still stored as sent.
- **Order of the checks.** A line that does not belong to the order
  (`details.code: 'unknown_line'`) is reported before any quantity error, the
  quantity check runs before the reason check (`unknown_reason`, or
  `RETURN_REASON_INACTIVE` for a reason that was switched off), and
  returnability is checked last. Cases opened before a product was marked not
  returnable are never re-evaluated.

**On upgrade, every existing product is not returnable.** The flag defaults to
off, so lines of orders placed after the release are not returnable until the
product is marked returnable in the catalogue — select the products on the
product list and use **Bulk edit → Returnable → Yes — returnable**. Orders
placed before the release are unaffected: their lines carry no recorded value
and stay returnable.

## In the audit log

A return case is an Organization's record, and the platform-wide audit log is read
by everybody holding `audit_log:read` whatever Organizations they may see. So the
case's entries name and count, and hold no amount and no free text:
`return.settled` records the resolution, the currency, the settlement state and
the correction's outcome, with the lines and charges it concerns by id or kind;
`return.status_changed` records the status and whether a reason was given. The
amounts are on the case and its refund. A reason given with a status change is
passed to the status events that change emits and
is not recorded anywhere else. Entries recorded before this change keep what they
were written with.

A complaint without a platform order settled outside the platform records
`offPlatform: true` and whether a note was given, never the note. Filing a case
(`return_case.create`), adding a file and changing a clause are recorded without the
customer's or the clause's text. Erasing an account's data
(`return_case.erase_personal_data`) records the number of cases and files and the
names of the fields erased.

A guest's writes are recorded with `by: 'guest'` and no actor: filing
(`return_case.create`, with the guest session's id), a comment through the tracking link
(`return_case.comment.add_by_guest`, with the comment's length, never its text) and a
file (`return_case.attachment.add`). *Send a new tracking link*
(`return_case.tracking_link.reissue`) records the link's version numbers, never the
link. Erasing a guest's data (`return_case.guest_data.erase`) records whether it was the
retention period or a request, the number of files and the names of the fields erased.
No entry holds a guest's e-mail address, name, phone, address, comment or link.

## Cross-module interfaces

The module reads/affects other domains only through documented ports, never
internal imports:

- `OrderReadPort.findByIdForCustomer` (orders) — whether the buyer may read the
  order a case is opened for (their own, or a colleague's with
  `orders.view_organization`).
- `OrganizationPermissionPort` (organizations) — `returns.create` and
  `returns.view_organization`, asked per request.
- `OrganizationDetailsPort.findById` (organizations) — whether the case's
  Organization is personal, read once when a return is filed.
- `OrderReturnContextPort` (orders) — paid-per-line amounts + completing-status
  time, the order's payment method, and each line's `returnableAtPurchase` (`true`/`false` as recorded at
  placement, `null` for an order placed before it was recorded). Orders reports
  the fact; the policy for `null` — returnable — is this module's. It also
  reports the order's delivery cost and payment surcharge.
- `OrganizationDetailsPort` (organizations) — whether the order's organization
  is a personal one (B2C), which decides whether a withdrawal refunds the
  delivery and the surcharge.
- `PaymentRefundPort` (payments) — issue the refund, answer `pending_manual`
  where no PSP integration exists, or refuse when the gateway that took the
  payment is switched off.
- `CorrectiveInvoicePort` (invoices) — create a `correction` invoice, or answer
  that none is due because the order carries no invoice to correct. A
  consumer's completing withdrawal also names the delivery and surcharge it
  refunds (`charges`).
- `CreditTopupPort` (credit_limits) — credit the organization grant.
- `ShipmentService` (shipments) — optional replacement outbound shipment.
- `TransactionalEmailSender` (transactional_emails) — every e-mail of this module.
- `CustomerAccountReadPort` (customer_accounts) — the filer's address and name.
- `AdminUserReadPort` (admin_users) — the authorizer's name and the administrators
  the new-case bell entry goes to; `PermissionReadPort` (admin_roles) — which of
  them hold `returns:read`.
- `AdminNotificationRecordPort` (admin_notifications) — the bell entries, only
  while that module is present.
- `AdminI18nTranslatePort` (_i18n) — the CSV export's *former administrator* and
  *unknown* in the administrator's language.
- `ObjectStoragePort` (assets_library) — the attachments' bytes, stored privately.
- `CatalogProductAvailabilityPort` (catalog) — whether a product named on a
  complaint without an order exists on the channel, and its name.
- `TransactionalEmailStatePort` (transactional_emails) — whether the confirmation
  e-mail is switched on, so the storefront promises it only then.
- `AdminTenantScopePort` (organizations) — whether an administrator may see every
  organization's cases, which decides who gets the bell entry for a guest case.
- The platform's cursor seal — signs the guest verification and tracking links with
  the session secret, so the platform stores no link.

## Schema

Migration `20260625T144227_returns_init.ts` creates `return_cases`, `return_case_items`,
`return_case_comments`, `return_statuses`, `return_status_transitions`,
`return_reasons`, `return_delivery_methods`, `refunds`, `return_shipments`,
`return_case_attachments`, `return_list_saved_views`, and the
`return_cases_rma_seq` sequence.

Migration `20261108T023047_returns_consumer_withdrawal.ts` adds the consumer
withdrawal's columns to `return_cases` (`consumer_withdrawal`, the consent
columns, and the facts of the reimbursement deadline) and creates
`return_withdrawal_statements`. It touches no other module's table, so it
leaves existing cases unclassified.

Migration `20261108T125405_returns_case_charge_refunds.ts` adds four columns to
`return_cases`: `default_delivery_refund`, `approved_delivery_refund`,
`default_surcharge_refund` and `approved_surcharge_refund`, each `0.00` by
default. Existing cases keep `0.00`.

Migration `20261113T145001_returns_authorizer_status_notifications.ts` adds
`return_cases.authorized_by_admin_user_id` and
`return_statuses.notify_customer_on_entry` (`false` for every status), and fills
the authorizer of already authorized cases from the newest authorizing entry of the
kernel's audit log that names an administrator.

Migration `20261113T155433_returns_off_platform_complaints.ts` makes
`return_cases.order_id` nullable — a case without an order must be a complaint with
a purchase date — and adds the purchase, contact, return address, accepted clauses,
resolution note, submission key and erasure columns. `return_case_items` gets a
nullable order line and product and a `serial_number`; `return_case_attachments`
gets the organization, the customer, the type, the file's name, type and size, where
it is stored and when an unfiled upload expires; the organization of existing
attachments is filled in from their case. It creates `return_case_clauses`. Rolling
it back is refused while a case without a platform order exists.

Migration `20261116T104415_returns_guest_complaints.ts` makes
`return_cases.customer_account_id` nullable — a case without an account is a guest's
complaint without a platform order and never carries an organization — and adds the
guest session that filed it, when its address was verified and the tracking link's
version. `return_case_comments` gets `author_guest`; `return_case_attachments` gets the
guest session that uploaded a file and `uploaded_by_guest`. It creates
`return_guest_verifications`, one row per link requested, which becomes the guest
session once redeemed and holds only a hash of the session token. Rolling it back is
refused while a guest case exists.
