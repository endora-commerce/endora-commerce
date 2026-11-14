---
'@endora-commerce/contracts': minor
---

Admin zones can now offer the host editor's save session (issue #407, `specs/180-one-save-zone-editors/`). The new `EditorSaveSessionHandle` (`{ readonly sessionId: string }`) is an opaque handle with no functions in its type. A required `saveSession: EditorSaveSessionHandle` prop is added to `ProductEditorZoneProps`, `ProductEditorFieldZoneProps`, `CategoryEditorZoneProps`, `SalesChannelEditorZoneProps`, `OrganizationDetailZoneProps` and `CustomerDetailZoneProps`. `ProductEditorSeoZoneProps` and every other zone are unchanged, so a contribution there that tries to join a Save fails the type-check.

This is a breaking change for anything that mounts one of these six zones: `<AdminZone>` and `useAdminZone()` calls must pass `saveSession`. A host that does not run a session yet can pass `INERT_SAVE_SESSION` from `@endora-commerce/admin-kit/lib`. Contributions that do not read the prop are unaffected.
