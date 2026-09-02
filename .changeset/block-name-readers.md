---
'@endora-commerce/page-builder-core': minor
---

Publish the four readers of a Page Builder block name.

```ts
import {
  formatBlockName,
  isNamespaced,
  ownerOf,
  parseBlockName,
  type ParsedBlockName,
} from '@endora-commerce/page-builder-core';
// or, from a migration, which wants none of this package's React:
import { ownerOf } from '@endora-commerce/page-builder-core/block-name';

parseBlockName('catalog.ProductGrid'); // { owner: 'catalog', local: 'ProductGrid' }
parseBlockName('Row');                 // null
ownerOf('orders.EmailOrderSummary');   // 'orders'
isNamespaced('Row');                   // false
formatBlockName('catalog', 'ProductGrid'); // 'catalog.ProductGrid'
```

A block name is `<ownerModuleId>.<LocalName>` and is persisted, so **import these
rather than splitting the string yourself** — that is the whole point of the
export, and the next release adds a CI check that refuses a second copy.

Two asymmetries are deliberate, and a consumer should know which side of each it
is on. **`parseBlockName` and `ownerOf` answer `null`** where the string is not a
well-formed block name, because the callers that matter are a data migration and
an operator report, both of which meet unrecognised names as a matter of course
and must leave the row byte-identical. **`formatBlockName` throws**, because
writing an unparseable name persists a node nothing can ever render.

**`isNamespaced` is stricter than `name.includes('.')`.** They agree on every
name in the pre-migration vocabulary, none of which contains a dot; they differ
on a *malformed* dotted name such as `acme.banner`, which the lax test would
report as already namespaced and this one reports as unrecognised — which is the
classification that gets it in front of an operator.

This package now depends on `@endora-commerce/contracts`, which authors the name
grammar (`blockNameRe`) that the manifest schema also has to enforce. It is a
workspace dependency and pulls in no third-party package a consumer of the
contracts is not already resolving.
