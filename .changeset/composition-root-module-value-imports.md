---
'@endora-commerce/mod-auth': minor
'@endora-commerce/mod-i18n': minor
'@endora-commerce/platform': minor
---

Retire the two module-package **value** imports the production composition root
still held.

`backend/src/composition.ts` names a module package 23 times over 21 packages.
Nineteen of those packages are reached type-only; two were reached by value, and
a value import does not retire by moving a type. That matters because
`specs/110-instance-repository/` T118 moves this root's contribution wiring, ORM
boot, request-scope hook, error-envelope options and tenant-context resolution
into `@endora-commerce/platform`, **where a platform file may not import a
module** (D-52, D-53). Each of the two needed a seam of its own, and they did not
want the same one.

**`@endora-commerce/mod-auth` — a port.** `promoteAdminActor` is no longer
exported from `./backend`. The implementation has not moved and must not: `auth`
reads it itself from `require-admin.ts`, and promotion is about `request.actor`
and `request.adminActor`, two decorations this module's plugin applies. It is
registered instead under the container name `promoteAdminActor`, which is the
step the old export's own doc block and
`test/contract/kernel/harness-parity.test.ts` both recorded as open — *"actor
promotion published as a port, resolved from the container"*.

```diff
-import { promoteAdminActor } from '@endora-commerce/mod-auth/backend';
-promoteAdminActor(request);
+import type { AdminActorPromotion } from '@endora-commerce/platform/kernel/ports/require-admin.js';
+// resolved from the container, never captured — the gate is transient
+const promote = container.cradle.promoteAdminActor as AdminActorPromotion;
+promote(request);
```

The module gains two things. The port, above. And **the actor types**, published
as `Actor`, `ActorAnonymous`, `ActorCustomer`, `ActorAdmin` and `ActorApiKey`,
because retiring the value import took something nobody had noticed it was
carrying: `plugin.ts` holds a `declare module 'fastify'` block adding `actor` and
`adminActor` to `FastifyRequest`, an ambient augmentation reaches a consumer only
if the declaring file is in that consumer's program, and the value import was the
only thing putting it there. Thirty reads of `request.actor` stopped compiling
the moment it went. A consumer that reads `request.actor` now writes a
**type-only** import from `./backend` and the augmentation travels with it.

**`@endora-commerce/mod-i18n` — a relocation, and a port was structurally
unavailable.** `buildErrorTranslationTargets`, `describeErrorCodeCollisions` and
their five shapes are gone from `./backend`; they are
`@endora-commerce/platform`'s now, at `kernel/i18n/error-translation.ts`, beside
`request-language.ts` — the producer of the other `ErrorEnvelopeOptions` member a
composition root injects.

```diff
-import { buildErrorTranslationTargets } from '@endora-commerce/mod-i18n/backend';
+// the platform's; no published subpath carries it, and no module calls it
```

The line it moved across is *the routing is derived from manifests, the
translation is a service*. `I18nService.translate` — what the envelope's
`translateErrorMessage` closure calls — stays here and is unchanged. The
derivation translated nothing: it read `manifest.errorCodes` off the resolved
manifest set, which is a composition-root input, and it had **no consumer inside
this package at all** — the barrel re-exported it and nothing here called it,
which is T040b's criterion 8, the test `absolutizePublicUrl` moved out of `email`
under. A port was not a design choice rejected on taste: the production root
calls this *before* `composeModules`, so there is no container to resolve one
from, and moving the call after composition would move the collision warning with
it — a diagnostic logged where it is so that an operator reads it before the
first request that renders wrong.

The aggregate return type is renamed `ErrorTranslationRouting`.
`http/error-envelope.ts` declares an `ErrorTranslationTargets` of its own — the
record this one's `targets` member is assigned to — and two types of one name in
one package, one being the input to the other's consumer, is a confusion with a
real cost. Nothing outside the package named the aggregate.

**`@endora-commerce/platform`** gains both targets and publishes neither on a
barrel: no module calls the derivation and no module resolves the promotion port,
so `specs/080-f4-real-scope/contracts/host-package.md` §1.3 classifies both
*unreached*, and putting a host-only name into the module-facing contract is what
that classification exists to prevent. `AdminActorPromotion` sits in
`kernel/ports/require-admin.ts` beside `RequireAdminFactory` and
`RequireCustomerGuard`, which is where a Fastify-shaped port type lives —
`@endora-commerce/contracts` declares no dependency on Fastify.

Behaviour is unchanged. `composition.ts` computes the same map at the same point
in the boot, logs the same collision warning, and promotes the same actor in the
same closure; the existing composition, error-envelope and harness-parity tests
are the assertion and none of them moved.
