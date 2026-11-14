---
'@endora-commerce/admin-kit': minor
---

**`@endora-commerce/admin-kit/lib`** adds the save session (issue #407, `specs/180-one-save-zone-editors/contracts/save-participation.md`). It lets the panels contributed to an editor's zones save with the editor's one Save:

- `SaveSessionProvider` (`resetKey`, optional `hostModule`) wraps a host editor. A new `resetKey` starts an empty session.
- `useSaveSession()` is the host side. It returns `handle` (pass it as the zones' `saveSession` prop), `dirtyCount`, `hasWritableParticipant`, `dirtyParticipants()`, `discardAll()`, `clearOutcome()`, `saving`, `notices`, `lastOutcome` and `run(hostPart, { stopOnFailure? })`.
- `useSaveParticipant(handle, { key, label, writable, loaded }, { changeCount, validate, save })` is the contributor side. Drafts are held by the session, so they survive the panel unmounting. The participant's id is `${module}:${key}`, and its module comes from the zone contribution that rendered it. Outside a zone, the provider's `hostModule` owns it. A participant whose module is switched off or whose contribution crashes is dropped with a notice. A `503 MODULE_DISABLED` from its write is reported as switched off.
- `runSave(parts, options)` is the pure orchestrator. It validates every part first and writes nothing if any part refuses. It then writes the parts in order: a blocking part that fails stops the run, and a non-blocking part that fails is recorded while the rest still run. `hasIssues` is exported beside it.
- `INERT_SAVE_SESSION` is the handle for a mount with no live session. A participant given it keeps a local draft and takes part in no Save.

Types: `SavePart`, `SaveContext`, `ParticipantIssues`, `SaveOutcome`, `SaveOutcomePart`, `SavePartResult`, `RunSaveOptions`, `SaveParticipantHandlers`, `SaveParticipantSpec`, `SaveParticipant`, `ParticipantStatus`, `SaveSessionValue`, `SaveSessionProviderProps`. `<AdminZone>` now tells each contribution which module and zone it renders in, and `ZoneErrorBoundary` reports a crashing contribution to the live sessions.
