# @endora-commerce/mod-quote-requests

## 0.105.0

### Minor Changes

- 31a2c0b: A custom field declares who reads its values, and customer-facing order and quote-request replies
  stop naming administrators. **Three breaking changes**, all described below.

  **Every custom-field definition has an `audience`: `customer` or `internal`.** Until now a
  definition had none, and whatever an administrator stored on an order or a quote request was
  answered to the customer (`GET /api/v1/orders`, `GET /api/v1/orders/:id`, the replies to placing
  and cancelling an order, `GET /api/v1/quote-requests/:id`) and to integrations
  (`/api/v1/external/orders`) as `customFieldValues`. An operator who modelled an internal note, a
  credit assessment or a risk flag as an order custom field was showing it to the buyer.

  - `internal` values are answered on admin routes only. `customer` values are also answered on
    the non-admin replies above. A stored value whose definition no longer exists is treated as
    internal. Admin replies are unchanged and carry every stored value.
  - **Existing definitions keep today's behaviour.** The migration
    `Migration20261010T090000CustomFieldsDefinitionAudience` adds
    `custom_field_definitions.audience` and sets every existing row to `customer`, so upgrading
    hides nothing. Review your definitions after upgrading and move to `internal` whatever was
    never meant to be shown.
  - **Breaking: a new definition is `internal` unless it says otherwise.**
    `POST /api/v1/admin/custom-fields/definitions` without `audience` used to create a field whose
    values the customer could read; it now creates one they cannot. Send `"audience": "customer"`
    to keep the old behaviour. `PATCH …/definitions/:id` accepts `audience` and leaves it alone
    when the key is absent. The same patch no longer resets a definition's `config` to `{}` when
    the body does not name it (`updateCustomFieldDefinitionSchema` carried the create default).
  - The definition screen (Custom Fields) shows the choice with an explanation, defaulting to
    internal, and lets the audience of an existing field be changed. Six keys join the module's
    `en` and `pl` bundles under `customFields.audience.*`.

  In `@endora-commerce/contracts`: new `customFieldAudienceSchema` / `CustomFieldAudience`;
  `customFieldDefinitionSchema` and `CustomFieldDefinitionRecord` gain a required `audience`;
  `createCustomFieldDefinitionSchema` defaults it to `internal`, so the inferred
  `CreateCustomFieldDefinitionRequest` — the input of `CustomFieldDefinitionApplyApi.applyCreate` —
  now requires it; and `CustomFieldValuePort` gains
  `projectForCustomer(entityType, bag)`, which returns only the keys a non-administrator may read.
  An implementation of that port must add the method. A host module that answers custom-field
  values to a non-administrator calls it in its serialiser; `mod-orders` and `mod-quote-requests`
  do. `mod-catalog` creates product attributes with `audience: 'customer'`; the audience is not
  consulted for product attributes, whose storefront visibility stays with the catalog's own flags.

  **Breaking: buyer-facing and external order replies no longer carry
  `placedOnBehalfByAdminUserId`.** It was the UUID of the administrator who placed the order for
  the customer, answered to the customer and to API-key callers. Those replies now carry
  `placedOnBehalf: boolean` instead. Admin order replies carry both. In `orderSchema`,
  `placedOnBehalf` is a new required key and `placedOnBehalfByAdminUserId` becomes optional
  (present on admin replies only). Replace `order.placedOnBehalfByAdminUserId !== null` with
  `order.placedOnBehalf` in a storefront or an integration; the reference storefront did not read
  the field.

  **Breaking: customer-facing replies carry no administrator identifier at all.** The same rule,
  applied to the other places it was broken:

  - Quote-request replies to a customer (`GET /api/v1/quote-requests/:id` and the replies to
    creating, patching, resubmitting a quote and to accepting or rejecting a revision) no longer
    carry `createdByAdminUserId` and `assignedAdminUserId`, and their `events[]` no longer carry
    `actorAdminUserId` (it was already always `null` there; the key is now absent).
    `actorRoleLabel` still says who acted.
  - Order-comment replies to a customer (`GET` and `POST /api/v1/orders/:id/comments`) no longer
    carry `authorAdminUserId`. A comment whose `authorCustomerAccountId` is `null` was written by
    staff.

  Admin replies are unchanged. In `quoteRequestSchema`, `quoteRequestEventSchema` and
  `orderCommentSchema` those four keys become optional (present on admin replies only). No boolean
  replaces them: the reference storefront declared the fields and read none of them.

  **Re-creating a deleted field.** Deleting a definition keeps its stored values. A
  `POST …/definitions` with `audience: "customer"` for a key that still has stored values is now
  refused with `409 CUSTOM_FIELD_DEFINITION_INVALID`, because it would answer those old values to
  customers at once. Create the field as `internal`, then change its audience. Product attributes
  (created through the catalog) are not affected.

  The definitions cache no longer stores a list that was read before an invalidation and arrived
  after it. A change of audience still takes up to 5 seconds to reach an API process that missed
  the invalidation message; the docs page says so.

  In `mod-orders`, `serializeOrder` is replaced by `serializeOrderForAdmin` and
  `serializeOrderForCustomer` (internal to the module).

- fe96d30: The Quote Request expiry sweep runs. Until now nothing called it.

  `RfqExpiryWorker.sweep()` was built, exposed on the module's handle and documented as running every
  30 minutes, and no scheduler, timer or command ever reached it. With `quote_requests.expiry_days`
  set, a Pending or Created from admin Quote Request never became `Expired`, nobody was told, and
  `rfq.expired.v1` was never emitted.

  **This changes what a running instance does.** The module now installs a BullMQ Job Scheduler on the
  queue `quote_requests.expiry.sweep` and a consumer for it, in every process that consumes queues.
  It fires every 30 minutes and stops with the module.

  **Which requests it expires.** `quote_requests.expiry_days = 0`, the default, disables the sweep.
  Otherwise a request is expired when all three hold:

  - it is still `Pending` or `Created from admin`;
  - nothing has been added to its history for `expiry_days` — the clock is the request's latest
    history entry, so a submission, an edit, a revision or a note restarts it, and the customer merely
    opening the request, or an assignment, does not;
  - **it carries no offer that is still valid**: when the seller dated an offer (`expiresAt`), that
    date wins, and the request is never expired by inactivity while the date is ahead. The sweep does
    not expire a request because its validity date passed; that date is enforced on accept and
    convert, as before.

  **Turning the setting on expires the backlog — read this before upgrading or changing it.** The rule
  applies to everything that is open, not from the day it is set. Moving `expiry_days` from `0` to
  `N`, or lowering it, expires over the next ticks every open request that has been inactive for more
  than `N` days. Releases up to 0.104.0 never ran the sweep, so an instance that already has the
  setting set meets the same backlog on the first ticks after this upgrade:

  - they all become `Expired`, get their `expired` history entry, and `rfq.expired.v1` is emitted for
    each;
  - **no notification record is written for a request that became due more than 24 hours before the
    tick that reached it.** A property of every run, not of the first one;
  - at most 500 requests are expired per tick, oldest first.

  Set `quote_requests.expiry_days` to `0` before upgrading to review the open requests first. The
  sweep reads the value of the default sales channel and applies it to requests of every channel; a
  channel set to `0` is not exempt.

  **The sweep and an answer are mutually exclusive.** A buyer's accept or decline, a customer's edit,
  and a seller's approve, revise, cancel or assign now take the request's row and check its `version`
  before writing; the sweep skips a request that is held. A transition that loses to the sweep — or
  to any other concurrent transition — is refused with `409 VERSION_CONFLICT`, where it used to
  succeed and overwrite. Before this, an accept racing the sweep answered `200` and left a request
  `Approved` with `expiredAt` set and an `rfq.expired.v1` announced for it.

  Also fixed in the sweep itself:

  - **A request that fails is retried later, not first.** The worker process leaves a request whose
    expiry failed alone for two hours, so requests that keep failing cannot be the head of every
    batch.
  - **A failure no longer loses events.** The pass flushed every due request to `Expired` and then
    walked them; a throw on the second of three left three requests `Expired`, one announced, and
    nothing for the next pass to find. Each request is now one transaction — status, history row and
    notification rows together — and its event is emitted after that transaction commits. A request
    that fails stays due for the next tick and does not stop the others.
  - **`rfq.expired.v1` carries `organizationId`**, the Organization the request belongs to. An
    additive field.
  - **An idle tick writes no audit row.** The tick asks whether anything is due before it enters its
    system scope.

  `RfqExpiryWorker.sweep()` now resolves to `{ expiredCount, failedCount,
notificationsSuppressedCount, reachedBatchLimit }`; `expiredCount` is unchanged in meaning.
  `RfqEventService.append` and `RfqNotificationService.enqueue` accept an optional transactional
  EntityManager.

- 602e5ba: Six more events are delivered to webhooks: three product events, two quote-request events and the
  credit-limit adjustment.

  They were emitted on the in-process event bus and delivered to nobody. Each is now offered on the
  Webhooks screen, accepted by the API and delivered, while the module that owns it is present:

  | Event                      | Owner            | Payload, beside `eventId` and `occurredAt`                      |
  | -------------------------- | ---------------- | --------------------------------------------------------------- |
  | `product.created.v1`       | `catalog`        | `productId`, `sku`                                              |
  | `product.updated.v1`       | `catalog`        | `productId`, `changedFields` (field names only)                 |
  | `product.archived.v1`      | `catalog`        | `productId`                                                     |
  | `rfq.created.v1`           | `quote_requests` | `rfqId`, `organizationId`                                       |
  | `rfq.expired.v1`           | `quote_requests` | `rfqId`, `organizationId`                                       |
  | `credit_limit.adjusted.v1` | `credit_limits`  | `organizationId`, `amount` (the granted limit after the change) |

  **The owning module offers its own events.** `catalog`, `quote_requests` and `credit_limits` push
  their event names into `webhooks`' `webhookEventRegistry` from a boot hook and declare the edge as
  `contributes-to` — the mechanism `crm` already uses. `webhooks` names none of them, and its two
  built-in types are unchanged. With `quote_requests` or `credit_limits` switched off, their types are
  not offered and a new subscription to them is refused; stored subscriptions are kept and receive
  nothing until the module is back.

  **Who receives them.** Product events carry no `organizationId`, so they reach platform-wide
  subscriptions only. Quote-request and credit-limit events reach platform-wide subscriptions and the
  subscriptions bound to that Organization, never one bound to another.

  **The payloads are published contracts.** `@endora-commerce/contracts` exports a strict schema for
  each — `CATALOG_WEBHOOK_EVENT_SCHEMAS`, `QUOTE_REQUEST_WEBHOOK_EVENT_SCHEMAS`,
  `CREDIT_LIMIT_WEBHOOK_EVENT_SCHEMAS` — with the matching `*_WEBHOOK_EVENT_TYPES` and
  `*_WEBHOOK_EVENTS` constants and one `…EventV1Schema` and type per event.

  Three changes of behaviour in the owning modules:

  - **`catalog` now emits `product.archived.v1` when a product's status moves to `inactive`.** The
    event was emitted only by a deprecated method nothing called, so no path an administrator, an
    import or a PIM synchronisation takes ever announced it. It is emitted once per transition, after
    the `product.updated.v1` of the same write, on every update path. A subscriber on the in-process
    bus — the search indexer removes the product from the index on it — now receives it. The
    archiving write waits for the subscribers of both events before it returns, so a reactivation
    that follows at once cannot be undone by a removal still on its way; on the unaudited update
    path (the API-key upsert, a bulk edit) that makes an archiving write as slow as its subscribers,
    where it used to return without waiting.
  - **`rfq.expired.v1` carries `organizationId`.** Without it the event could reach no subscription
    bound to an Organization. An additive field.
  - **`CreditLimitService` constructed without a Command Bus emits `credit_limit.adjusted.v1` after
    its transaction has committed**, not from inside it, so an adjustment whose commit fails is not
    announced. The composed module always has a Command Bus and was not affected.

  **A contributed event type is delivered only while its owner is present.** `webhooks` asked for
  its own presence before delivering and not for the contributing module's, so an event carrying the
  name of a switched-off module was still delivered to the subscriptions stored for it. The bridge
  now asks per event, for every contributed type — the `crm` ones included. The two built-in order
  events are unaffected.

  Not delivered, and documented as such: a product being deleted (`product.deleted.v1` stays
  in-process), and a product being reactivated (there is no un-archive event; it shows as `status` in
  `changedFields`). `rfq.expired.v1` is sent only by the quote-request expiry sweep, so it occurs
  only on an instance where that sweep runs.

  **Volume.** Nothing is batched: a bulk edit, an import or a PIM synchronisation writes products one
  by one, so a subscription to `product.updated.v1` receives one delivery per product written. An
  event type no subscription names enqueues nothing.

### Patch Changes

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [202f0d9]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
- Updated dependencies [79bd849]
- Updated dependencies [31a2c0b]
- Updated dependencies [266cd38]
- Updated dependencies [bdb823b]
- Updated dependencies [8d4440f]
- Updated dependencies [8ca54eb]
- Updated dependencies [6b2ba06]
- Updated dependencies [be5b3ce]
- Updated dependencies [82ca6dd]
- Updated dependencies [38e8818]
- Updated dependencies [335750c]
- Updated dependencies [602e5ba]
- Updated dependencies [8ee69de]
  - @endora-commerce/contracts@0.105.0
  - @endora-commerce/platform@0.105.0
  - @endora-commerce/admin-kit@0.105.0

## 0.104.0

### Minor Changes

- 32775d5: Two additive seams for other modules; an instance in which nobody uses them behaves as before.

  - **A new in-process event, `rfq.created_by_admin.v1`** (`rfqId`, `organizationId`,
    `adminUserId`, `origin | null`), emitted once per quote request created through
    `POST /api/v1/admin/quote-requests`, which accepts an optional opaque `origin: { type, id }`
    and hands it on unread. `rfq.created.v1` is still emitted for a customer's own submission
    only, so nothing that listens to it starts seeing requests an administrator prepared.
  - **The create screen (`/quote-requests/new`) can be opened by another screen**: it reads
    `originType`, `originId`, `organizationId`, `customerAccountId` and `returnTo` from its query
    string. Opened without them it behaves as before.
  - **A new admin zone, `quote_request.detail.after`**, mounted once at the end of a quote
    request's screen with `{ quoteRequestId }`. The module names no contributor; with nothing
    contributed the screen is unchanged.

- 85793d6: A quote request that a customer orders is now completed by that order.

  `POST /api/v1/quote-requests/:id/convert-to-order` has always seeded the basket at the agreed
  prices; it now also marks the basket with the quote request, so the order placed from it
  records `sourceQuoteRequestId` (see `@endora-commerce/mod-orders`). The module's existing
  `order.created.v1` subscriber — which sets `Completed`, `converted_order_id` and sends the
  `completed` notification — had nothing to react to until now, so **on upgrade, accepted quote
  requests start being completed when they are ordered, and a completed one can no longer be
  converted a second time** (`409 RFQ_NOT_QUOTED`). Quote requests ordered before the upgrade
  stay `Approved`; nothing is backfilled.

  Two changes to that subscriber:

  - It waits for the order's commit. The event is announced from inside the placing
    transaction, so the order is sometimes not readable yet; the subscriber now looks again —
    off the event bus, for a little over two seconds — instead of giving up at the first read.
    An order that is still not readable after the last look is **logged at `warn`**, naming the
    order: almost always a placement that rolled back, and otherwise an order whose quote request
    was left `Approved`.
  - It never completes a quote request for an order of another organization.

  **Breaking for anyone composing `quoteRequestsModule(...)` by hand**: `QuoteRequestsModuleOptions`
  gains two required members, `deferAfterCommit(work)` and `isStillPresent()`. The packaged
  composition (`registerModule`) supplies both.

  The response of `convert-to-order` is unchanged, and so is every other route.

### Patch Changes

- 8820b6f: **A quote request is accepted, approved and ordered only once the seller has priced it.**

  A quote line is sold at the unit price the seller agreed, and a line the seller has not priced has
  no price at all. Three operations now hold that rule, and each answers `409` when it is not met:

  - `POST /api/v1/quote-requests/:id/accept-revision` answers `RFQ_NOT_QUOTED` when the seller has
    made no offer to accept — the request is neither `Created from admin` nor awaiting the customer's
    acceptance of a seller revision — and `QUOTE_INCOMPLETE` when the seller's offer leaves a line
    without an agreed unit price.
  - `POST /api/v1/admin/quote-requests/:id/approve` answers `QUOTE_INCOMPLETE` while any line has no
    agreed unit price. An operator who wants to approve a request as the customer raised it prices
    every line first (`PATCH /api/v1/admin/quote-requests/:id`), then approves.
  - `POST /api/v1/quote-requests/:id/convert-to-order` answers `QUOTE_INCOMPLETE` while any line has
    no agreed unit price, whichever way the request came to be approved.

  `QUOTE_INCOMPLETE` was already one of the module's declared error codes and nothing raised it; it
  and `RFQ_NOT_QUOTED` now carry a real sentence in English and Polish in place of the generated
  placeholder.

  What an instance should expect:

  - The rules are about a **missing** price. An agreed unit price of exactly `0` that an operator
    entered is an agreed price like any other, and such a request is accepted, approved and ordered
    as before.
  - `reject-revision` is unchanged: a customer can still withdraw a request the seller has not
    answered.
  - **A request that is already `Approved` with an unpriced line can no longer be converted into an
    order — that is intended.** Its lines cannot be edited in that status, so the way forward is
    `resubmit`, which raises a new request for the seller to price. To find them:

    ```sql
    select distinct qr.id, qr.business_id
      from quote_requests qr
      join quote_request_items it on it.quote_request_id = qr.id
     where qr.status = 'Approved' and it.agreed_unit_price is null;
    ```

  - Orders already placed are not touched. An order placed from such a request before this release
    carries the unit price it was placed at; the same query with `qr.status = 'Completed'` lists the
    requests to review.

- Updated dependencies [32775d5]
- Updated dependencies [2f95785]
- Updated dependencies [32775d5]
- Updated dependencies [dbf6778]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [7af6470]
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/platform@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/platform@0.103.0

## 0.102.0

### Patch Changes

- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/admin-kit@0.101.1
  - @endora-commerce/contracts@0.101.1

## 0.101.0

### Patch Changes

- Updated dependencies [89b0de3]
- Updated dependencies [667e9e1]
- Updated dependencies [be758bb]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d919418]
  - @endora-commerce/platform@0.101.0
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1

## 0.11.7

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0

## 0.11.6

### Patch Changes

- Updated dependencies [0af8db8]
- Updated dependencies [7b1f09e]
- Updated dependencies [8418b7d]
- Updated dependencies [a12d4bf]
- Updated dependencies [6738f35]
- Updated dependencies [9ef7f4b]
- Updated dependencies [1b3fb93]
  - @endora-commerce/contracts@0.17.0
  - @endora-commerce/admin-kit@0.9.7
  - @endora-commerce/platform@0.13.3

## 0.11.5

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.11.4

### Patch Changes

- 32fdf20: The `LICENSE` file in each package now names the copyright holder as Endora sp. z o.o.

  The MIT licence text is unchanged; only its copyright line moves from `Copyright (c) 2026 Endora`
  to `Copyright (c) 2026 Endora sp. z o.o.`, the registered legal entity. Nothing a package exports,
  declares or depends on changes. `@endora-commerce/contracts` and
  `@endora-commerce/mod-invoice-ledger` also carry a one-sentence rewording in an already-published
  `CHANGELOG.md` entry, with no change to what that entry says about the code.

- Updated dependencies [43f445d]
- Updated dependencies [b9c6686]
- Updated dependencies [f89d305]
- Updated dependencies [32fdf20]
- Updated dependencies [07f1e8c]
- Updated dependencies [67dfca3]
- Updated dependencies [f89d305]
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0
  - @endora-commerce/admin-kit@0.9.5
  - @endora-commerce/platform@0.13.1

## 0.11.3

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0
  - @endora-commerce/admin-kit@0.9.4

## 0.11.2

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3

## 0.11.1

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2

## 0.11.0

### Minor Changes

- 6b2ed26: `QuoteRequestReadPort` gains `findByBusinessId(businessId)`, answering the quote carrying a
  human-facing business id or `null`.

  It exists because `comarch_xl` needs it: an ERP offer names the quote it answers by the
  reference a person read off the document, never by the uuid. The connector had been reading
  `quote_requests` with a raw `select`, which crosses the module boundary without any
  specifier naming it and keeps returning rows after an operator has switched
  `quote_requests` off. Consumers resolve it through the container name
  `quoteRequestReadPort`, as they do the other three methods.

### Patch Changes

- 8f61a6b: Every published package now ships its own `LICENSE` and `README.md`.

  npm force-includes a file named `LICENSE` into the tarball exactly as it does `README.md`,
  whatever `files` says, so the text has to be in the package directory and not only at the
  repository root — `LICENSE-COMMERCIAL.md` states that rule and, until this release, no package
  obeyed it. Measured on `master`: **0** of the 82 publishable packages carried a `LICENSE` and
  **14** carried a `README.md`, so every tarball shipped without licence text and 68 registry
  pages would have rendered empty.

  Both files are **generated**, by `pnpm --filter backend run manifests:generate`, and refused
  when stale by `manifests:check` in the `quality` job:
  - the `LICENSE` is the repository's root `LICENSE`, copied verbatim — the same single source
    the `license: MIT` field is already rendered from. A package that declares a licence of its
    own in the `SEE LICENSE IN <file>` form is skipped and keeps the file it names.
  - the `README.md` is rendered from what the package's own manifest declares: its description,
    its module id where it has one, every published subpath with what that layer holds, its peer
    dependencies with the optional ones marked, the locales its `i18n/` carries and what the
    tarball ships. A `README.md` **without** the generated marker on its first line is a human's
    and is never rewritten — the fourteen that existed are untouched.

  Five module packages also get their npm description back. `@endora-commerce/mod-blog`,
  `mod-credit-limits`, `mod-dhl-parcel`, `mod-google-analytics` and `mod-quote-requests` carried
  the note written when they were moved out of `backend/src/modules` — _"the first module to
  leave backend/src/modules … the manifest id stays identity of record"_ — as the sentence a
  registry shows under the package name. Each now carries the sentence its own module manifest
  declares, which is where `descriptionFor` seeds one from in the first place.

  No API changes, no new dependency, no behaviour change: what moves is what the tarball carries
  and what a package page says.

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/admin-kit@0.9.1
  - @endora-commerce/platform@0.11.1

## 0.10.0

### Minor Changes

- 0eeb9b5: Require Node >= 22.18.0.

  The previous floor was 22.17.0, which MikroORM 7 sets. 22.18.0 is the first release that
  strips TypeScript types without a flag, and that is what loads a deployment's overlay module:
  in a scaffolded instance `apps/` is outside every compiled member, so the unit the platform
  `import()`s is the client's own `.ts`. On 22.17.x that import throws
  `ERR_UNKNOWN_FILE_EXTENSION` and the process dies before it listens. Emitting a `.js` beside
  the client's source was measured and refused — the overlay loader resolves `.js` before `.ts`
  while the divergence derivation admits both, so the sibling doubles every seam site in the
  report.

  Derived by probing 22.17.0, 22.17.1, 22.18.0 and 22.19.0 against a `.ts` module imported with
  no flag; 22.18.0 is the lowest that loads it.

  If you run 22.17.x, upgrade to 22.18 or later. Nothing else in these packages changed.

### Patch Changes

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/contracts@0.11.0

## 0.9.1

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.9.0

### Minor Changes

- 6c8d958: Eight migration statements move to the module whose dependency closure guarantees the table they
  name (D-226, `specs/120-migration-closure-bridge-ownership/` Phase 3).

  A migration may name a table only if its own module creates it, a module in its transitive manifest
  `dependencies` closure creates it, or the platform creates it. Where that did not hold, an instance
  that omitted the creating module could not migrate a fresh database at all — the failure this rule
  was ruled from was `relation "cms_pages" does not exist`.

  **No class is renamed and no stamp moves.** `mikro_orm_migrations` persists the migration class name
  and holds no checksum (measured on `@mikro-orm/migrations@6.6.13`), so a database that has applied
  one of the reduced bodies is offered nothing from it. What an upgrading consumer receives is the
  five new migrations below, each written idempotently, each a no-op against a database that already
  has the object and the real change against a fresh one. Measured on a database migrated at the
  previous revision: exactly five pending, every table's `pg_class` OID unchanged after applying
  them, and the resulting schema byte-identical to the previous revision's fresh schema.

  **`@endora-commerce/platform`** — two frozen bodies lose statements they could never have been
  ordered for, the platform declaring no dependencies and so never being orderable after a module's
  table. `Migration20260430T170044CoreSalesChannelsPromote` no longer adds `quote_requests.sales_channel_id`,
  its foreign key or its index. `Migration20260717T134752CoreTenantScopeIndexes` is now **empty** —
  all three of its indexes were on module-owned tables — and the class stays, because its name is on
  `BASELINE_MIGRATIONS` and removing it would move seventy frozen positions.

  **`@endora-commerce/mod-quote-requests`** — new `Migration20260912T125614QuoteRequestsQuoteRequestChannelAttribution`:
  the `sales_channel_id` column, its `ON DELETE RESTRICT` foreign key and its index, `add column if not exists`
  with the constraint add guarded by a `pg_constraint` probe. The column is still NULLABLE.

  **`@endora-commerce/mod-analytics`** — new `Migration20260912T125655AnalyticsEventsTenantScopeIndexes`:
  the two tenant-key indexes on `analytics_events`, verbatim and `if not exists`.

  **`@endora-commerce/mod-newsletter`** — new `Migration20260912T125702NewsletterSubscriberTenantScopeIndex`:
  the tenant-key index on `newsletter_subscribers.customer_account_id`, verbatim and `if not exists`.

  **`@endora-commerce/mod-cms`** — new `Migration20260912T125709CmsPageBodyAssetRefIndex`: the GIN
  index on `cms_pages.body`. It exists for `assets_library`' reference-protection scan and now lives
  with the table it is on; `cms` declares `assets_library` and not the other way round, so this is the
  only direction in which the closure holds.

  **`@endora-commerce/mod-assets-library`** — `Migration20260505T102206AssetsLibraryInit` no longer
  creates that index. An instance installing this package without `cms` no longer carries a migration
  that indexes a table nothing builds.

  **`@endora-commerce/mod-inventory`** — new `Migration20260912T125716InventoryOrganizationWarehouses`:
  the `organization_warehouses` bridge, `create table if not exists`, verbatim columns, primary key and
  both foreign keys. This is D-226's bridge rule one namespace over — an always-present near side
  (`organizations`) and a switchable far side — and it has a visible consequence:
  `module:uninstall --hard inventory` now reverts this table, a hard uninstall reverting by registry
  module id.

  **`@endora-commerce/mod-organizations`** — `Migration20260611T140349OrganizationsConsolidation` no
  longer creates `organization_warehouses`. Its `warehouses` foreign key named a table this module
  neither owns nor declares, and could not declare: `inventory` already declares `organizations`.

- 8e86e55: Eleven container names a module read and nothing defaulted are now defaulted by
  the module that reads them, so a composition that contributes nothing can
  resolve every one of them.

  `@endora-commerce/platform` — `composeApp` registers two more names:
  `customerOrganizationIdResolver`, the tenth actor-shaped name, whose value
  expression reads `request.actor` and nothing else; and `newsletterTokenSecret`,
  the resolved `NEWSLETTER_TOKEN_SECRET`.

  `@endora-commerce/mod-newsletter` — `newsletterModule`'s `defaultChannelId`
  option becomes `resolveDefaultChannelId: () => Promise<string | null>`. A
  consumer composing the module through `registerModule` is unaffected; a consumer
  calling `newsletterModule` directly passes `async () => null` where it passed
  `null`. The `NewsletterBridge` interface is removed — the module reads its nine
  members itself.

  `mod-catalog`, `mod-customers`, `mod-ksef`, `mod-orders`, `mod-quote-requests` —
  each registers the names it reads. No published shape changes; a composition
  that contributes one of them still overrides the default, which is what the
  contribution window is for.

  `mod-catalog`, `mod-customers` and `mod-orders` declare new manifest edges for
  ports they now resolve themselves: `catalog` -> `search:searchReindexPort`,
  `customers` -> `admin_roles`, `orders` -> `admin_users` and `admin_roles`. Every
  one of those owners declares `activation.nonDeactivatable`, so no operator loses
  an activation control.

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/admin-kit@0.8.1

## 0.8.0

### Minor Changes

- e27bf6c: Every package that ships scannable UI now publishes its own Tailwind `@source`
  declarations at a new `./tailwind.css` subpath.

  A host compiling this package's utility classes no longer has to know where the
  package's sources are. Import the subpath from the stylesheet that builds your
  admin, and the package names its own layers:

  ```css
  @import 'tailwindcss';
  @import '@endora-commerce/mod-blog/tailwind.css';
  ```

  `@source` resolves relative to the stylesheet that declares it, so the paths hold
  wherever the package is installed. The file is generated from the package's layer
  inventory, ships in the tarball beside `package.json`, and its `dist` line is the one
  that matters to you — the `src` line beside it is inert in a published package and
  exists so that a checkout of this repository keeps scanning source in `dev`.

  **Nothing is removed or renamed**: every existing subpath resolves exactly as before.
  What is new is the obligation on the _host_ side, and it is a build error rather than a
  silent one. Before this, a host reached these packages with a glob over the monorepo
  (`@source "../../packages/**"`), which named a directory no installed tree has —
  and Tailwind reports nothing at all about a source that matches nothing, so such a host
  built green and rendered every screen unstyled. A host that now names a package that is
  not installed gets `Can't resolve`, and one whose tarball omits the file gets
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

  `@endora-commerce/cms-components` deliberately does **not** publish this subpath. It
  ships a finished, prefixed stylesheet at `./styles.css` and must not also be scanned by
  its host.

### Patch Changes

- Updated dependencies [16a9a6d]
- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [eb01958]
- Updated dependencies [4eeb5cd]
- Updated dependencies [a6a9d30]
- Updated dependencies [016524f]
- Updated dependencies [fb2659a]
- Updated dependencies [9eb0cb6]
- Updated dependencies [7e80824]
- Updated dependencies [e1748da]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [6521134]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [74a4797]
- Updated dependencies [9a5d4d2]
- Updated dependencies [a655909]
- Updated dependencies [1beac89]
- Updated dependencies [7fb0567]
- Updated dependencies [304f6d8]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [e27bf6c]
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/admin-kit@0.8.0
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0

## 0.7.0

### Minor Changes

- a28c796: `invoices`, `ksef` and `quote_requests` ship their admin surfaces, and the first zone whose
  host is a module package.

  **New `./admin` subpath on three packages.** `@endora-commerce/mod-invoices`,
  `@endora-commerce/mod-ksef` and `@endora-commerce/mod-quote-requests` each export
  `contributions` — an `AdminContributions` object — from `@endora-commerce/mod-<id>/admin`, and
  nothing else. Eight routes and three sidebar entries between them, all at the paths and codes
  the hand-written host registrations carried:
  - `mod-invoices` — `/invoices` (the landing route), `/invoices/templates`,
    `/invoices/templates/:id` and `/invoices/:id`, all on `invoices:read`, which is the code
    every `GET` behind those four screens enforces; each screen keeps gating its own writes on
    `invoices:write` inside itself. One sidebar row, in the `sales` section at weight 500. The
    two template screens deliberately have no row: they are reached through
    `InvoiceSectionTabs`, which this package already owned.
  - `mod-ksef` — `/ksef` on `ksef:read`. One sidebar row, `sales`, weight 600. Its glyph is
    `Receipt` rather than the `ReceiptText` the host table rendered by hand, because
    `KnownIconNameSchema` does not carry the second and `Receipt` is what this module's
    `open-ksef` palette action has always named.
  - `mod-quote-requests` — `/quote-requests` (the landing route), `/quote-requests/new` and
    `/quote-requests/:id`, all on `rfqs:handle`, which is the module's only code and the one
    its admin routes build a single guard from. One sidebar row, `sales`, weight 400.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **`@endora-commerce/contracts` gains one zone member and its props.**
  `AdminZoneNameSchema` carries `'invoice.detail.after'` and `AdminZonePropsMap` maps it to the
  new exported interface `InvoiceDetailZoneProps { invoiceId: string; kind: InvoiceKind;
ksefReferenceNumber: string | null }`. Additive: no existing member, props type or export
  changes. A host mounts it with

  ```tsx
  <AdminZone name="invoice.detail.after" props={{ invoiceId, kind, ksefReferenceNumber }} />
  ```

  and a contributor declares
  `zoneComponent('invoice.detail.after', () => import('./MyPanel.js'), { weight, requiredPermission })`,
  whose module's default export is constrained to `ComponentType<InvoiceDetailZoneProps>`.

  **`@endora-commerce/mod-ksef` publishes the first contribution into another package's screen.**
  `InvoiceKsefPanel` is a zone component now — same rendering, same `ksef:read` gate, same
  proforma guard — and `@endora-commerce/mod-invoices` renders the place rather than importing
  the panel. Neither package names the other in any specifier. It is a zone and not a published
  component because the panel's signature is three values in and nothing out; and it carries no
  `match`, because the place has a single host and a single mount, and `match` has no negation to
  write "not a proforma" with.

  **`@endora-commerce/mod-i18n` loses four keys nothing renders any more** —
  `appShell.nav.invoices`, `appShell.nav.ksef`, `appShell.nav.quoteRequests` and
  `appShell.palette.sub.customerRfqs`. Each module's sidebar label is module-relative now
  (`nav.invoices.label`, `nav.ksef.label`, `nav.quoteRequests.label`) and ships in that module's
  own `i18n/` bundle in both shipped languages.

- 0ec3f95: A permission declares what it depends on, and a catalogue row says who owns it.

  **`@endora-commerce/contracts`.** `modulePermissionDeclarationSchema` gains an
  optional `requires: string[]` — the codes a role holding this one also needs
  before the surface it opens is whole. It is advisory: no guard reads it, no role
  upsert is refused, and it is **not** a lifecycle edge, so declaring it does not
  put the named code's owner into your module's `dependencies` and does not stand
  in the way of an operator switching that owner off.

  ```ts
  // packages/modules/<id>/src/manifest.ts
  permissions: [
    { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
  ],
  ```

  `permissionCatalogueEntrySchema` — the row `GET /api/v1/admin/permissions`
  returns, and the return type of `PermissionCataloguePort.listAssignable()` —
  gains `owners: string[]` (required) and `requires?: string[]`. `owners` is the
  set of modules whose presence keeps the code grantable, and it is **not** the
  existing `module` field, which is a display grouping: `_lifecycle` files its
  codes under `module: 'module_lifecycle'`, which is no module id, and a shared
  code such as `integrations:manage` has two owners and one grouping.

  Readers need no change — the two fields are additive on the wire. **If you
  construct a `PermissionCatalogueEntry`** (a test double, a second implementation
  of `PermissionCataloguePort`), add `owners`:

  ```ts
  // before
  const row: PermissionCatalogueEntry = { code: 'blog.read', module: 'blog', label: 'View' };
  // after
  const row: PermissionCatalogueEntry = {
    code: 'blog.read',
    module: 'blog',
    label: 'View',
    owners: ['blog'],
  };
  ```

  New export `missingPermissionRequirements(granted, catalogue)`: the codes a role
  holding `granted` is advised to add, over the catalogue rows the platform
  already merged. It skips a requirement naming a code the given rows do not
  offer, and advises a `'*'` role nothing. It exists so that the role editor and
  the permission inventory read one function rather than two.

  **`@endora-commerce/mod-admin-roles`.** `PermissionCatalogueService` puts
  `owners` and `requires` on every row it merges, unions `requires` across every
  declarer of a shared code, and gains `listRequirementsByCode()`.

  **`@endora-commerce/mod-admin-users`.** The role editor renders the shortfall for
  the codes currently ticked, with a one-click add, and shows a row's owner set
  wherever it says something the display grouping does not.

  **`@endora-commerce/mod-quote-requests`.** Declares `rfqs:handle` with
  `requires: ['price_lists:read']` — the RFQ create screen prefills a price from a
  `price_lists` route, so a role holding only `rfqs:handle` falls back to manual
  entry.

  **`@endora-commerce/mod-i18n`.** Six `adminRoles.*` keys for the above, in both
  shipped languages.

- d5f7022: The validity deadline an operator sets on a Quote Request is enforced again.

  `expiresAt` — written from `expiresInDays` by `RfqAdminService.modify` and
  `createOnBehalf`, serialised into `QuoteRequest`/`QuoteRequestSummary`, and shown to both
  parties as `expires <date>` — was read by no rule. The feature-008 workflow rewrite
  (`4f24dc948`) dropped the live check `accept()` carried and nothing replaced it, so a
  customer could accept a revision and convert an approved quote to a cart at its agreed
  unit prices for ever. `RFQ_EXPIRED` and `QUOTE_VALIDITY_ENDED` stayed enumerated in
  `ERROR_CODES` with sentences in both shipped languages, raised by nothing.

  **Two customer transitions now refuse**, both with `410`, both only when the operator
  actually set a deadline (`expiresAt` absent still means no deadline):
  - `POST /api/v1/quote-requests/:id/accept-revision` → `RFQ_EXPIRED`
  - `POST /api/v1/quote-requests/:id/convert-to-order` → `QUOTE_VALIDITY_ENDED`

  The two codes are the split
  `specs/001-b2b-platform-foundation/contracts/quote_requests.contract.md` already made —
  the offer that lapsed undecided, and the accepted quote that ran out — restored rather
  than invented. Neither is redundant: they carry different remedies, and a client
  discriminating on `error.code` can say which happened.

  **Nothing else changes.** `reject-revision` and `resubmit` stay open — declining a lapsed
  offer consumes no committed price, and resubmit is the buyer's way forward; it raises a
  new request carrying no deadline. Every admin path is untouched, so the operator can
  re-quote a lapsed request with a fresh `expiresInDays` and the customer can then accept.
  The expiry worker is a different concept and is not touched: it sweeps `updatedAt` against
  a settings-wide `expiryDays` and never reaches `Approved`.

  **If you consume the customer routes**, handle `410` on those two paths. The envelope
  carries the code and the module's own translated sentence; the placeholder strings under
  `errors.RFQ_EXPIRED` and `errors.QUOTE_VALIDITY_ENDED` are replaced with real prose in
  `en` and `pl`.

  There is no data migration. A request whose `expiresAt` is already in the past refuses on
  both paths from the moment this lands — that is the rule, not an accident of deployment.

- f1ff167: New package: the Quote Requests (RFQ) module, the second to leave `backend/src/modules/`
  (feature 080, T040b).

  Three subpaths, no root wildcard, every one of them compiled output (D-164):
  - `@endora-commerce/mod-quote-requests` — the manifest. Isomorphic,
    `@endora-commerce/contracts` its only import, and where the generated manifest index reads
    the module's identity, settings, palette action and activation control from.
  - `@endora-commerce/mod-quote-requests/backend` — `registerModule(ctx)`, the two ports it
    publishes (`quoteRequestReadPort`, `rfqService`), and the `entities` array the host's ORM
    registry spreads. **No entity class is exported by name** (D-168): the five
    `QuoteRequest*` classes are imported by the barrel to build that array and nothing else,
    so `import type { QuoteRequest } from '@endora-commerce/mod-quote-requests/backend'` does
    not compile in a consumer's tree, whoever the consumer is.
  - `@endora-commerce/mod-quote-requests/migrations` — the `migrations` array the platform's
    package loader reads, plus the six migration classes by name for the host's migration
    registry. The names are contract in a way an entity class name is not: they are what
    `mikro_orm_migrations` persists, so every already-migrated database holds them as strings.

  `@endora-commerce/platform` is a `peerDependency` (D-160.2), and so are `@mikro-orm/*`,
  `fastify` and `zod`. Unlike `mod-blog` this package declares no `ioredis` peer, because it
  imports none: it keeps no cache of its own, and `RfqExpiryWorker` is a plain `sweep()` a
  caller drives — the name is historical, there is no BullMQ consumer behind it.

  The manifest id stays `quote_requests` — identity of record for the lifecycle registry, the
  settings store, the `rfqs:handle` permission code, the i18n bundle paths and the ownership of
  all six migrations (D-142). The npm name is only how npm keeps names unique.

  **What this package proves that `mod-blog` could not.** It ships six migrations rather than
  one, so the per-module ordering chain has more than one link, and its `ctx.subscribe`
  subscriber **writes** — `order.created.v1` completes the originating quote request — so a
  test can tell a registered subscriber from an unregistered one, which is the obligation the
  first module package left uncovered.

### Patch Changes

- 73da94f: Each of these packages now carries the unit tests that cover its own sources,
  and a `vitest` configuration and `test` script to run them.

  For a consumer the manifest is what changed: `vitest` joins `peerDependencies`
  and `devDependencies`, and `scripts.test` is `vitest run`. Both are rendered by
  `manifests:generate` from the package's own layer inventory, so they follow the
  test files rather than being declared by hand. Nothing exported moves: the test
  files are excluded from `tsconfig.build.json`'s emit and from the `files` list,
  so the published tarball is byte-identical apart from the manifest.

  Running them needs nothing but the package — that is the property that decided
  which files moved. A test that composes a backend server, reads a live Postgres
  or Redis, or names anything under `backend/` stayed where it was.

- 67eeced: `quote_requests` declares the nine error codes it owns.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
  (`specs/090-module-owned-error-codes/`). Nothing the package exports changes
  shape. The observable difference for a consumer is that this module's error
  sentences are now routed by its own declaration rather than only by the
  `RFQ_`/`QUOTE_` prefix rule in `@endora-commerce/mod-i18n`, which continues to
  answer identically for every one of them: the list is the chain's own answer,
  copied from the frozen capture, and is asserted equal to it in both directions.

  No `tokens` are declared: none of the nine carries a refusal discriminator —
  all ten raise sites of the three codes anything raises pass no `details.code`,
  and the other six are raised by nothing at all.

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [68044b1]
- Updated dependencies [a85b425]
- Updated dependencies [4c9892c]
- Updated dependencies [972e7ed]
- Updated dependencies [b1589fd]
- Updated dependencies [316f44b]
- Updated dependencies [45e77bb]
- Updated dependencies [ebc08af]
- Updated dependencies [47c958f]
- Updated dependencies [b2552d5]
- Updated dependencies [7140eed]
- Updated dependencies [cebad9c]
- Updated dependencies [1d84094]
- Updated dependencies [196fbfa]
- Updated dependencies [543151a]
- Updated dependencies [e5ae42c]
- Updated dependencies [f11ccdb]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [214cbdb]
- Updated dependencies [3c8102e]
- Updated dependencies [4e964e0]
- Updated dependencies [dc5c19d]
- Updated dependencies [c53fef3]
- Updated dependencies [c94c52d]
- Updated dependencies [4013a8b]
- Updated dependencies [fc34995]
- Updated dependencies [1050b9a]
- Updated dependencies [32cc6e4]
- Updated dependencies [63be98c]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [e7bbadc]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [2cd9c14]
- Updated dependencies [aab1f32]
- Updated dependencies [764b379]
- Updated dependencies [bbf9258]
- Updated dependencies [0a2bbd4]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
  - @endora-commerce/admin-kit@0.7.0
  - @endora-commerce/platform@0.7.0
