---
'@endora-commerce/cli': patch
'create-endora-commerce': patch
---

The two READMEs a reader meets on npmjs now say what the packages do. `create-endora-commerce`'s still said *Not yet published* and that its command did not resolve; it now shows the two commands, what they write, and links the getting-started page. `@endora-commerce/cli`'s was the generated stub that described "scaffolding and conformance tooling" and nothing else; it now lists `endora install`, `new instance`, `new storefront`, `new module`, `generate`, `dev` and `check` with one line each, and is hand-written from here on — the manifest generator no longer rewrites it.
