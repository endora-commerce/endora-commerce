---
'@endora-commerce/mod-auth': minor
---

`auth` now records when an administrator was last seen, and answers the question.

- **`AuthSessionReadPort.lastSeenByAdminUser(adminUserIds, since)` answers** — it rejected
  until now. The newest `lastSeenAt` per administrator among those asked about, restricted to
  sessions seen at or after `since`; an administrator with no such session is absent from the
  answer. A session in which an administrator is impersonating a customer is the customer's
  presence and does not count.
- **An authenticated request carrying the admin session cookie stamps
  `sessions.last_seen_at`**, as a customer's request has since the online-customers view:
  fire-and-forget, and throttled by the session service to one row update per session per
  minute (one Redis `SET NX EX 60` per request). Until this change the column held an
  administrator's sign-in time and nothing after. With the Admin UI open the notification
  bell polls every 30 seconds, so "seen in the last few minutes" means in practice "has the
  Admin UI open in a browser" — it does not say anybody is looking at it.

No schema change: the column and its index on `admin_user_id` exist. Customer and
impersonation sessions are stamped exactly as before.
