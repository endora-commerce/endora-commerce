---
'@endora-commerce/mod-catalog': minor
---

The module declares its demo data: `manifest.demo` creates the demo's three-level category tree,
200 generated products, three composites and the composites' own structure, and withdraws them
again.

`endora demo seed` now reports `catalog` by name with what it created, and `endora demo reset`
removes it. Both bodies are reached by a relative `await import()` from the manifest, so nothing
is loaded by the processes that merely compose the platform, and the module gained no `exports`
subpath, no `files` entry and no manifest `dependencies` entry.

**The catalogue is generated, not shipped.** The products, their descriptions and their images
are built in process, so this package ships no non-`.ts` demo asset at all: 200 products cost
the same bytes as 10 000.

**Three things the block used to hold are not this module's demo data.** A product attribute is a
`custom_fields` definition paired to one of this module's extension rows; a placeholder image and
a sample attachment each mint an `assets_library` asset and hand its id to one of this module's
tables. Each writes two modules' rows in one statement, so each belongs to whoever owns the
instance. A consumer that seeds through this body alone gets a catalogue with no attributes, no
images and no attachments — a coherent shop, and a plainer one.

**The withdrawal changed, and it is the largest repair in the series.** The host's demo reset
cleared `products`, `categories`, the composites' three structure tables and eleven more with a
`truncate … cascade`. It now deletes only the slugs and the slug prefix `seed` assigns, deepest
first, so a catalogue an operator has been building survives a demo reset — as do their uploaded
assets and their own product-host attributes, which the same cascade had been taking.

Seeding twice creates nothing the second time and reports the same counts.
