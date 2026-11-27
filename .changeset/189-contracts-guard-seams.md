---
'@endora-commerce/contracts': minor
---

States the four guard seams once (`specs/189-command-middleware/`, issue #1841; D-296). New exports: `GUARD_SEAM_REGISTRATIONS` (`['commandBus', 'auditLogService', 'eventBus', 'emFactory']`), the `GuardSeamRegistration` type, `isGuardSeamRegistration(name)` and `guardSeamReplacementFor(name)`, which returns what to use instead of decorating that seam. The platform's deprecation warning and the CLI's `deprecated-decoration` finding both read them; an overlay's decoration of a guard seam is deprecated in 0.113.0 and refused from 0.114.0.
