---
'@endora-commerce/platform': minor
---

Deprecates an overlay module's decoration of the four guard seams (`specs/189-command-middleware/`, issue #1841; D-296, narrowing D-156.4). `ctx.di.decorate('commandBus' | 'auditLogService' | 'eventBus' | 'emFactory', …)` from a deployment's overlay module still composes and keeps its wrap in this release, and now logs `kernel.decoration.deprecated` at `warn` once per (module, name), with `{ overlay, registration, replacement, refusedFrom: '0.114.0', ruling: 'D-296' }`. The decoration's `DecorationRecord` and its `kernel.decorations` line carry `deprecated: true`. **From 0.114.0 composition refuses it with `GuardSeamDecorationError`.** Replace the wrap before then:

| Wrapped name | Replacement |
| --- | --- |
| `commandBus` | command middleware: `admit` to refuse, `observe` to measure; a command hook for one declared action |
| `auditLogService` | `observe` middleware for an extra sink, or a read of `audit_log_entries` for a durable one; the audit writer itself is not replaceable |
| `eventBus` | `ctx.subscribe` for a reaction; an `afterCommit` hook for durable delivery |
| `emFactory` | none. Tenant scoping is not overridable (Principle XI). Ask the owning module for a port |

Nothing else changes: an overlay may still decorate another overlay module's registration, a workspace module's, and any other root-supplied registration (`redis`, `orm`, `requireAdmin`, …) with no warning. Core modules and installed packages are refused exactly as before.
