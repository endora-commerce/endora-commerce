---
title: Customer notifications
description: A notification centre in the buyer's storefront account — entries other modules record for one customer account, read and marked read on the storefront, and deleted after a retention period
---

# Customer notifications (`customer_notifications`)

The Customer notifications module keeps a **notification centre** for buyers.
Other modules record an entry for one customer account when something the
buyer should know about happens — for example, *Quote requests* records one
when an operator approves or revises a quote request. The buyer reads the
entries in their storefront account, sees how many are unread, opens one, and
marks one or all of them as read.

The module has no admin screen of its own. Its settings are on the
**Settings** screen, in the *Customer notifications* group, and it is switched
on and off on **Platform → Modules**.

## What a buyer sees

- **Their own entries only.** An entry is addressed to one customer account of
  one organisation. Another member of the same organisation does not see it;
  each person is told separately.
- **Entries for the shop they are on.** An entry about something that belongs
  to one sales channel is shown only on that channel; an entry that belongs to
  no channel is shown on every channel. Marking all entries as read on one shop
  leaves the entries of another shop unread.
- **Entries in their language.** Each entry is shown in the language the
  storefront asks for. When a translation is missing, the English text is
  shown.
- **Only entries whose module is on.** An entry recorded by a module that is
  switched off is hidden, and comes back when the module is switched on again.

An entry can lead to a page — a quote request, for instance. Opening the entry
marks it as read.

Today *Quote requests* is the one module that records entries: the requester
and the members of the organization who may open the request get one when the
request is submitted or re-submitted, its offer is accepted or rejected, it is
prepared, revised, approved or cancelled by the shop's staff, or it expires. The buyer whose own action caused the change
gets no entry for it — they are looking at the result, and the e-mail confirms
it. The *Quote requests* module's page says who is told, and when.

## On the storefront

- **The unread count on the account entry.** There is no separate bell in the
  header. While a signed-in buyer has unread entries, the account entry shows
  the count: the account button on wide screens, and the account tab of the
  bottom tab bar on narrow ones, whose menu drawer also has a *Notifications*
  row with the count. It shows on every page at every screen width, except
  during checkout. The badge shows at most `9+`; a screen reader hears the
  exact count after the entry's name ("Unread notifications: 12"). A guest, or
  a buyer with nothing unread, sees no badge. The count is refreshed whenever a
  page is loaded and right after the buyer opens an entry or marks entries
  read; it is not refreshed live.
- **The Notifications page** (`/account/notifications`) is the second item of
  the account navigation, after the profile, with the unread count beside it
  ("Notifications (2)"). The account overview shows a line such as *You have
  2 unread notifications* linking to it.
- **The list.** Entries are listed newest first, 20 to a page, with *Show
  older* for the next page. Each shows its sentence and its date — relative
  ("2 h ago") for the last seven days, the date after that. An unread entry is
  marked *New* and in bold, so the difference does not rest on colour.
- **Opening an entry.** An entry with a link is a real link: it can be opened in
  a new tab or copied. Opening it marks it as read and takes the buyer to the
  page it is about; if marking fails, the buyer still gets there. An entry
  without a link has a *Mark as read* button instead.
- **Mark all as read** is offered while something is unread. It marks the
  entries of the shop the buyer is on, announces the result beside the heading
  and moves the focus to the heading; if it fails, an error says so and the
  buyer can try again.
- **Empty and error states.** With no entries the page says what will appear
  there and, when quote requests are available to the buyer, offers *Go to
  quote requests*. When the list cannot be loaded, the page says so and offers
  *Try again*.
- **Push.** When push notifications are switched on for the shop, the page ends
  with *Manage push notifications*, which leads to the buyer's push choices on
  their account profile. Push itself is the *PWA* module's.

## Impersonation

When an operator impersonates a buyer, the notification centre can be read,
but nothing is marked as read: the buyer still finds their unread entries when
they sign in themselves. Opening an entry still leads to its page; *Mark all as
read* is shown disabled, with the reason beside it.

## Retention

Entries are deleted when they are older than the retention period. The period
is the **Keep notifications for (days)** setting, from 7 to 730 days, 90 by
default, and it applies to every sales channel. A sweep runs once a day.

The same sweep deletes the entries of customer accounts that were deleted or
anonymised.

## Switching it off

**Customer notifications enabled** switches the centre on or off. While it is
off:

- the storefront shows neither the notifications page (its address answers the
  shop's *page not found*) nor the unread count, the account navigation item or
  the overview line, and the notifications API answers that the module is not
  available;
- modules that would record an entry skip it — *Quote requests*, for example,
  records the delivery as skipped because the module is off;
- the retention sweep does not run.

Nothing is deleted. Entries recorded before the module was switched off are
kept and reappear when it is switched back on.

## Settings

Both are in the *Customer notifications* group of the **Settings** screen and
apply platform-wide.

| Code | Type | Default | Effect |
| --- | --- | --- | --- |
| `customer_notifications.enabled` | boolean | `true` | The module's activation control, also on **Platform → Modules**. |
| `customer_notifications.retention_days` | number | `90` | **Keep notifications for (days)**, from 7 to 730; a value outside the range is refused when it is saved. |

## For developers

Other modules record entries through the published port
`customerNotificationRecordPort` (`CustomerNotificationRecordPort` in
`@endora-commerce/contracts`):

- `recordWithin(em, input)` persists the entry into the caller's unit of work,
  without flushing it, so the entry commits or rolls back with the caller's own
  change;
- `record(input)` writes the entry on its own and answers the existing entry
  when one with the same `sourceModule` and `sourceKey` is already recorded.

An entry carries the English sentence (`title`, and optionally `body`) beside a
translatable message (`titleMessage`, `bodyMessage`: a module id as `scope`, a
key in that module's translation bundle, and `params` of strings and numbers).
The link is a storefront-relative path that starts with a single `/`; an
absolute or protocol-relative URL is refused. A caller decides whether the
module is present before it calls the port, and does not catch the refusal the
port answers while the module is off.

The storefront API, for a signed-in buyer:

| Method | Path | Answer |
| --- | --- | --- |
| `GET` | `/api/v1/storefront/notifications?limit=1..50&cursor=` | the entries, newest first, a cursor for the next page and the unread count |
| `GET` | `/api/v1/storefront/notifications/unread-count` | the unread count |
| `GET` | `/api/v1/storefront/notifications/:id` | one entry, without marking it as read; `404` for an entry the list would not show |
| `POST` | `/api/v1/storefront/notifications/:id/read` | `204`; `404` for an entry that is not the caller's |
| `POST` | `/api/v1/storefront/notifications/read-all` | the number of entries marked as read |

Every answer is `Cache-Control: private, no-store`. Each shows only the
caller's own entries, of the request's sales channel and of no channel, and
only those whose producing module is present; entries are rendered in the
request's language, with the English sentence as the fallback. Under
impersonation the reads answer and the two writes change nothing. While the
module is off every route answers `503 MODULE_DISABLED`, and the port refuses
with `ModuleDisabledError`.

The retention sweep is a BullMQ Job Scheduler on the queue
`customer_notifications.retention.sweep`, once a day, registered through
`ctx.worker`. An idle tick enters no tenant scope.

The storefront side lives in `storefront/`: the page, its server actions and
the open route under `app/(account)/account/notifications/` (`page.tsx`,
`actions.ts`, `[id]/open/route.ts` — `GET /account/notifications/<id>/open`
reads the entry by id, marks it read and answers `303` to its link), the API
client `lib/api/customer-notifications.ts`, the count on the account entry in
`components/Header.tsx`, `components/mobile/MobileTabBar.tsx` and
`components/Megamenu/MegamenuMobileDrawer.tsx`, and the copy in
`lib/i18n/messages/account.ts` and `chrome.ts`. Every surface is rendered only
while `customer_notifications` is present.
