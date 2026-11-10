---
'@endora-commerce/mod-assets-library': patch
---

Issue #991: a public file's `304 Not Modified` now carries `Cross-Origin-Resource-Policy: cross-origin`, as its `200` always did. The browser merges a 304's headers into the cached response, so the host's default `same-origin` replaced the 200's policy on revalidation and a storefront on another origin than the API saw its images blocked (`net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`) — intermittently, only for addresses without `?v=`, which are `public, no-cache` and so revalidated. Private files still carry no such header.
