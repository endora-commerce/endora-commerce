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

## Impersonation

When an operator impersonates a buyer, the notification centre can be read,
but nothing is marked as read: the buyer still finds their unread entries when
they sign in themselves.

## Retention

Entries are deleted when they are older than the retention period. The period
is the **Keep notifications for (days)** setting, from 7 to 730 days, 90 by
default, and it applies to every sales channel. A sweep runs once a day.

The same sweep deletes the entries of customer accounts that were deleted or
anonymised.

## Switching it off

**Customer notifications enabled** switches the centre on or off. While it is
off:

- the storefront shows neither the notifications page nor the unread count, and
  the notifications API answers that the module is not available;
- modules that would record an entry skip it — *Quote requests*, for example,
  records the delivery as skipped because the module is off;
- the retention sweep does not run.

Nothing is deleted. Entries recorded before the module was switched off are
kept and reappear when it is switched back on.

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

Every answer is `Cache-Control: private, no-store`.
