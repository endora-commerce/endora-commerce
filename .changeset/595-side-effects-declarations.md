---
'@endora-commerce/contracts': patch
'@endora-commerce/cms-components': patch
'@endora-commerce/email-components': patch
'@endora-commerce/page-builder-admin': patch
---

The four packages now declare `sideEffects` in `package.json`, so a bundler can drop the modules a consumer imports through a barrel but never uses:

- `@endora-commerce/contracts`: `false`. Its modules build Zod schemas, constants and pure helpers, and none of them does anything when it is imported.
- `@endora-commerce/cms-components`: `["*.css"]`, so `@endora-commerce/cms-components/styles.css` imported from JavaScript is still kept.
- `@endora-commerce/email-components`: `["*.css"]`, for the published `tailwind.css`.
- `@endora-commerce/page-builder-admin`: `["*.css", "./dist/email/EmailEditorPane.js"]`. The e-mail editor pane imports the CMS and Puck stylesheets, so it is kept.

The exported API does not change, and a consumer does not need to change anything. In this repository's admin build, the JavaScript loaded with the entry page shrank from 931.6 kB to 649.6 kB (gzip: 266.1 kB to 193.4 kB), and in the storefront build the first-load JavaScript of the CMS, catalogue, product and checkout pages shrank by 73 to 79 kB per page (`/` 729 kB to 650 kB, `/checkout` 271 kB to 198 kB). The stylesheets are the same.
