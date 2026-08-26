---
'@endora-commerce/mod-pim-ergonode': minor
---

`pim_ergonode` is a package: `@endora-commerce/mod-pim-ergonode`, with three subpaths (`.` for
the manifest, `./backend` for composition, `./migrations` for the two migration classes) and an
`i18n/` bundle directory beside `dist`.

Two things it publishes that a consumer has to know about, and one it deliberately does not.

**`./backend` exports an `entities` array and no entity class by name** (D-168). The ten
`Ergonode*` classes are reachable only through that array, which is the value the host's ORM
registers, so there is exactly one of each in a process. If you want a row's *shape*, the
contract is in `@endora-commerce/contracts`.

**`./backend` exports `ErgonodeRequestError` by name**, and that is not an inconsistency with
the paragraph above. The transport decides "retry or give up" from
`err instanceof ErgonodeRequestError`, so any implementation of `ErgonodeClientPort` — a real
client, an overlay's, a test's fake — has to throw *this* constructor or its outage is
classified as an ordinary defect. Across a package boundary `instanceof` compares constructors,
so an implementor reaching the class by any other route holds a second one and the test is
silently `false`.

```ts
import { ErgonodeRequestError } from '@endora-commerce/mod-pim-ergonode/backend';

throw new ErgonodeRequestError({ reason: 'auth', operation: 'products', attempts: 1 });
```

**What it does not publish is the import pipeline's own failure signal**, on purpose: that one
is classified structurally, off a `failureCode` property, because the run recorder has no reason
to know which of two errors it caught. Structural classification is the cheaper answer and
survives any number of package seams; publish a class only where `instanceof` really is the
contract.

Nothing about the module's behaviour, schema or HTTP surface changes. The two migration classes
keep their names, so a database that has applied them sees nothing pending.
