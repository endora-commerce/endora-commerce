---
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-assets-library': patch
---

Both modules declare `demo: false` — a decision recorded rather than a field filled in.

The demo shop holds seven product-host custom-field definitions and about five hundred assets,
and not one of them is either module's own demo data. A product attribute is a definition paired
1:1 with a `catalog` extension row and written in one call; every demo asset is minted inside a
loop over `catalog`'s products, with its filename and its generated image derived from the
product it hangs off, and its id handed straight to one of `catalog`'s tables. Each is two
modules' rows in one statement and belongs to whoever owns the instance.

For `custom_fields` this also settles a question the feature's own artefacts left open, and
settles it against the proposal: the definitions cannot be seeded here with the extension rows
seeded by `catalog`, because `catalog` would then have to read `custom_field_definitions` to find
the id its extension references, and a module's demo body may not read another module's table.

Absent and `false` are different states, so this changes no behaviour: it says the modules owe
nothing rather than leaving it undecided.
