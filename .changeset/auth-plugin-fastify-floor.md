---
'@endora-commerce/mod-auth': patch
---

`authPlugin`'s runtime Fastify version check (the `fastify-plugin` `fastify` option) now
requires `^5.11.0` instead of `5.x`, matching the `fastify` peer range every published manifest
declares. Registering the plugin on Fastify 5.0–5.10 now fails with
`FST_ERR_PLUGIN_VERSION_MISMATCH` at boot instead of starting a server in which an async handler
missing its `return` crash-loops the process.
