---
'@endora-commerce/mod-ksef': minor
---

`./test-support` publishes the four test certificates this module's tests sign with

`@endora-commerce/mod-ksef/test-support` now also exports `TEST_RSA_CERT_PEM`, `TEST_RSA_KEY_PEM`,
`TEST_EC_CERT_PEM` and `TEST_EC_KEY_PEM` — static, self-signed RSA-2048 and EC P-256 material,
generated once with openssl and never used against a real KSeF environment. They were
`backend/test/unit/ksef/fixtures.ts` in the monorepo; the unit tests that own them now sit beside
their subjects in this package, and the host's server-bound KSeF tests read the same certificates
through this subpath instead of through a path into the package's sources.

`minor` rather than `patch`: this is additive published surface, on the `mod-inpost` precedent. In a
`0.x` series a minor takes every caret dependent out of range, which is what a consumer pinning this
subpath should notice about it changing shape.

Nothing on `.`, `./backend`, `./migrations` or `./admin` moves, so a deployment using the module sees
no change. `./test-support` is the development-only layer. The package's own unit tests grew by the
five files that moved in (`ksef-auth`, `ksef-client`, `xades`, the sweep's presence handling and the
unsupported-rate bundle entries) plus `src/admin/submission-error.test.ts` and
`src/admin/index.test.ts`; tests are not emitted.
