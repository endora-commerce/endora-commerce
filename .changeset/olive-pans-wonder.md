---
'@endora-commerce/mod-api-keys': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-pim-ergonode': patch
'@endora-commerce/mod-pim-pimcore': patch
'@endora-commerce/mod-pim-unopim': patch
'@endora-commerce/mod-webhooks': patch
---

Documentation: these packages' pages no longer link Endora's own documentation
site by relative path.

A page each package ships under `docs/` linked `../architecture/…` or
`../integrations/…` — a page above the modules category, which is site content
and travels with no package. Installed anywhere but the Endora repository, the
link named a page that is not there, and a documentation build over the
installed set therefore failed under Docusaurus's `onBrokenLinks: 'throw'` —
whatever else was installed alongside. The guides are now named in prose.

No exported symbol, schema, route or translation key changes.
