---
'@endora-commerce/mod-crm': minor
'@endora-commerce/contracts': minor
---

The tabs of an Opportunity say how much is behind them. *Notes* and *Attachments* show their number
of items, as *Links* already did; *Events* keeps the number of Events that have not ended yet; and
*Messages* shows how many messages the signed-in administrator has not read. A tab with nothing
behind it shows no number. Each number is read aloud with what it counts — "Notes, items: 3",
"Events, upcoming: 2", "Messages, unread: 1" — and follows a change made on its own tab without a
reload of the page.

Unread messages are counted per administrator: a message somebody else wrote after the point you
have read up to. Opening the *Messages* tab reads them, for a holder of `crm:read` alone as well,
and one administrator's reading changes nothing for another. Reading is not a change to the
Opportunity and leaves nothing in its change history.

`OpportunityDetail` (`GET /api/v1/admin/crm/opportunities/:id`, and every answer that carries the
Opportunity) gains three members: `noteCount`, `attachmentCount` and `unreadMessageCount`. One new
route, `POST /api/v1/admin/crm/opportunities/:id/messages/read` with `{ throughMessageId }`, gated
`crm:read`, answers `{ unreadMessageCount }`. `upcomingEventCount` is unchanged.

One migration, `20261009T163307_crm_opportunity_message_reads`, creates
`crm_opportunity_message_reads` and `crm_message_read_baselines`. It records the instant it ran, and
messages written before it are unread for nobody — so an upgrade does not hand every administrator
every existing conversation to catch up on. No new permission and no new Setting.
