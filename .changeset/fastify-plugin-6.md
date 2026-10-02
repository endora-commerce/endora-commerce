---
'@endora-commerce/platform': patch
'@endora-commerce/mod-auth': patch
---

`@endora-commerce/mod-auth` now peers on `fastify-plugin@^6`, and `@endora-commerce/platform` depends on `^6.0.0`. `@fastify/cookie`, `@fastify/cors` and `@fastify/helmet` moved their own dependency to `fastify-plugin@6`, and pnpm gives a peer the project does not declare the highest version in the graph — so every fresh install handed `mod-auth` `6.0.0` and reported `unmet peer fastify-plugin@^5`. `6.0.0` is the same code as `5.1.0` under a renamed entry file, with the deprecated `PluginOptions` type alias removed; nothing here used it. Nothing to do on upgrade unless your project declares `fastify-plugin` itself, in which case move it to `^6`.
