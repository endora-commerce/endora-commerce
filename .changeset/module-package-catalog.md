---
'@endora-commerce/mod-catalog': minor
---

`catalog` is a package: `@endora-commerce/mod-catalog`, with three subpaths (`.` for the
manifest, `./backend` for composition, `./migrations` for the twenty-one migration classes) and
an `i18n/` bundle directory beside `dist`. It is the largest module in the tree — 18 entities,
35 services and four route surfaces — and nothing about its behaviour, schema or HTTP surface
changes with the move.

**`./backend` exports an `entities` array and no entity class by name** (D-168). Eighteen
classes are reachable only through that array, which is the value the host's ORM registers, so
there is exactly one of each in a process. That number is why the array's shape matters more
here than anywhere else: a consumer that picks a class out of it with a `find` gets the union of
eighteen constructors, which TypeScript collapses to one member that is almost certainly not the
one asked for. Take the class by **name**, never by index. If you want a row's *shape*, the
contract is in `@endora-commerce/contracts`.

**Three names leave `./backend` on purpose**, all of them for host programs that construct
catalogue state rather than serve it:

```ts
import {
  CatalogProductReadService, // the read surface price-list migration is driven from
  legacyToCfType, // legacy attribute value type -> unified custom-field triple
  type CatalogQueryService, // the cradle slot a composition root declares
} from '@endora-commerce/mod-catalog/backend';
```

`CatalogProductReadService` and `legacyToCfType` are a service and a pure function, so D-168 —
which bars *entity* classes from this door — does not reach them; `CatalogQueryService` is a
type and evaluates nothing. A host program cannot name this package's source instead: a
compiled build sets `rootDir`, and a `.ts` outside it is a compile error even under
`import type`.

**Two `fastify` request properties this module reads are not its own.** `request.actor` and
`request.apiKeyBinding` are `declare module 'fastify'` augmentations owned by `auth` and
`api_keys`. Inside one program they are ambient; a package is its own program, so the two reads
narrow locally rather than importing an interface neither owner publishes. An overlay wrapping
`routes.external.ts` should expect the same.

The twenty-one migration classes keep their names, so a database that has applied them sees
nothing pending.
