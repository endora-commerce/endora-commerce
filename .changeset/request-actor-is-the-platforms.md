---
'@endora-commerce/mod-auth': minor
'@endora-commerce/platform': minor
'@endora-commerce/contracts': minor
---

`request.actor` is declared by the platform, and `Actor` no longer carries the session.

**`@endora-commerce/mod-auth` — breaking, two ways.**

`Actor`, `ActorAnonymous`, `ActorCustomer`, `ActorAdmin` and `ActorApiKey` are no
longer exported from `@endora-commerce/mod-auth/backend`. Import them from
`@endora-commerce/contracts` instead:

```ts
// before
import type { Actor, ActorAdmin } from '@endora-commerce/mod-auth/backend';

// after
import type { Actor, ActorAdmin } from '@endora-commerce/contracts';
```

And the `declare module 'fastify'` block that adds `actor` and `adminActor` to
`FastifyRequest` is no longer in this package. If you imported from
`@endora-commerce/mod-auth/backend` only to make `request.actor` compile — a
type-only import whose real job was to put the ambient declaration in your
program — the import to write now is a normal one you probably already have:

```ts
// before — erased at build time, and load-bearing anyway
import type { Actor } from '@endora-commerce/mod-auth/backend';

// after — any import from this subpath carries the declaration
import { HttpError } from '@endora-commerce/platform/http';
```

**`ActorCustomer.session` and `ActorAdmin.session` are gone.** They were the
`Session` ORM entity, written onto every authenticated request. If you read one,
resolve `authSessionPort` or `authSessionReadPort` from the container: both are
declared in `@endora-commerce/contracts` and both answer with `AuthSessionRecord`,
a plain shape rather than an entity. Nothing else about the actor changed — the
same four kinds, the same fields, resolved by the same `onRequest` hook.

**`@endora-commerce/contracts`** gains `Actor` and its four members, at
`./actor.js` and on the root barrel. It imports neither Fastify nor the ORM.

**`@endora-commerce/platform`** gains the Fastify augmentation on its existing
`./http` subpath — no new subpath and no new export, because the file declares
the two request properties and exports no symbol. Any import from
`@endora-commerce/platform/http` brings it.
