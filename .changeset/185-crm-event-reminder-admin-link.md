---
'@endora-commerce/mod-crm': minor
---

The `crm_event_reminder` e-mail links into the admin panel (follow-up to issue #185). With
`ADMIN_BASE_URL` set, it sends the new variable `event.adminUrl`. That is
`<ADMIN_BASE_URL>/crm/opportunities/<opportunityId>?tab=events&event=<eventId>`, the address of
the bell entry. The default template, in English and Polish, shows an **Open the event** /
**Otwórz wydarzenie** button to it. With `ADMIN_BASE_URL` unset the variable is not sent and the
button is left out. A relative or guessed link is never sent. A customised template that does
not name `event.adminUrl` renders as before. The manifest declares the variable for the
template editor.
