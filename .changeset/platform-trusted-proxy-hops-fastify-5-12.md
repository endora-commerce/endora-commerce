---
"@endora-commerce/platform": patch
---

`TRUSTED_PROXY_HOPS` keeps working on fastify 5.12.1 and later.

fastify 5.12.1 removed the numeric `trustProxy` option: a number now fails closed, so a backend
started with `TRUSTED_PROXY_HOPS=1` against a fresh fastify would silently report the proxy as
every request's client again — one shared rate-limit bucket and audit rows naming the proxy.
`buildServer` now translates a hop count into fastify's function form, `(address, hop) => hop <
hops`, which is exactly what fastify compiled the number into before 5.12.1, so `request.ip`,
`request.ips`, `request.protocol` and `request.host` resolve as they did. `trustedProxy` and
`parseTrustedProxy` are unchanged, and the address-list form (`TRUSTED_PROXY_ADDRESSES`) is
passed through as before. Operators keep `TRUSTED_PROXY_HOPS` as it is; no action is needed.

The platform's own fastify development range moves to `^5.12.5`; its peer range stays `^5`, and
the translation works across the whole 5.x line.

A hop count, like the numeric option it replaces, does not look at the connecting address, so it
is only safe when the backend cannot be reached except through its proxies (fastify's advisory
GHSA-3m5p-2c4r-xxw2). If the backend port is reachable directly, set `TRUSTED_PROXY_ADDRESSES`
to the proxies' addresses instead.
