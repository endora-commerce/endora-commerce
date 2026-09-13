---
'@endora-commerce/platform': minor
'@endora-commerce/cli': minor
---

An overlay module is a whole lifecycle participant, a wrapped `asValue` no longer kills the boot,
and the divergence report attributes the deployment's own registrations.

**`@endora-commerce/platform`**

- `composeApp`'s default composition — the one an instance takes, having no generated manifest
  index — resolves overlay module **manifests** from the same root it composes overlay module
  **entries** from. It passed `overlay: async () => []` to `resolveManifestEntries`, so a
  deployment's overlay module reached the container, the permission gate and the presence
  projection and never `lifecycleManifestRegistry`: no `module_registrations` row from the boot
  reconcile, no activation Setting, and nothing for an operator to switch it off against. Both
  seams now come off one `overlayModulesUnder(root, claims)` reader, so the id-collision claim set
  is asserted once over one array.
- `ctx.di.decorate` over a registration awilix marks leak-safe and gives no lifetime — which is
  exactly `asValue`, and exactly what a composition root's `registerValues` produces for
  `commandBus`, `auditLogService`, `eventBus` and `emFactory` — registers the wrapper
  `.singleton()` instead of asserting TRANSIENT. Wrapping any of those names used to boot until
  the first singleton resolved it and then throw `AwilixResolutionError: … has a shorter lifetime
  than its ancestor`, which made D-156.4 a ruling sanctioning an operation that could not be
  performed. Every other inner resolver keeps the lifetime it had, and a wrap reaching for a
  genuinely scoped registration still throws.

**`@endora-commerce/cli`**

- `endora generate`'s owner map now includes the container names the deployment's own overlay
  modules register, merged per deployment and keyed from each source's own module id. A client
  decorating a name their own overlay module registered was attributed to nobody and drew an
  `unowned-subject` finding whose remedy text — "Composition throws for it at boot" — was untrue
  of a tree that had booted.
- `endora generate` evaluates the report's refusals and exits 2 on one, instead of rendering a
  report over inputs it could not read.
- A seam call in an overlay module written in JavaScript, or in TypeScript with no `ModuleContext`
  annotation, is read: the first parameter of an exported `registerModule` is a context receiver,
  which is the loader's own contract rather than a naming convention. Such a client used to get a
  clean report over a tree full of decorations.
- A new refusal: a rendering that both lists `registration:<module>:<name>` and reports
  `unowned-subject` for `<name>` is refused rather than printed.
