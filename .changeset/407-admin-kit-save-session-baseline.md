---
'@endora-commerce/admin-kit': minor
---

Save-session additions, needed by the first editor to adopt the session (issue #407):

- `SaveParticipantHandlers.validate` and `save` now receive the participant's saved state as a third argument, `baseline`, so a part can check and write only what changed. Handlers that take two arguments keep working.
- `useSaveSession()` returns `zoneOf(partId)`, the zone a participant rendered in, or `null` for a host-owned section. A host uses it to take the operator to the part from the summary's "Show" without naming the contributing module.
- Fix: a panel that remounts while its read is still in flight no longer discards the draft the session kept for it.
