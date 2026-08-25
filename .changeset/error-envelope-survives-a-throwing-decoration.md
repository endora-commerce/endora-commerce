---
'@endora-commerce/platform': patch
---

`registerErrorEnvelope` no longer lets a failing localisation replace the error
it was localising.

The `preSerialization` hook that swaps an error's written message for the
registered sentence in the caller's language calls two host-injected callbacks —
`resolvePreferredLanguage` and `translateErrorMessage`. Either can throw, and a
throw there is not an ordinary failure: the hook runs while a reply Fastify is
already treating as an error is being serialised, so Fastify cannot route it
back through `setErrorHandler` and falls back to its own serialiser. The
response then stops being an `ErrorEnvelope` at all — `{ statusCode, code,
error, message }`, in which `error` is the status phrase and `error.code` is
`undefined`, so `@endora-commerce/api-client` builds an `ApiError` reading
`undefined: undefined`.

Every other exit from that hook already returns the payload unchanged (no
translation target, a `VALIDATION_FAILED` carrying a machine-readable token, a
sentence with an unfilled placeholder). The throw now does the same: the
untranslated envelope is served, in `LANGUAGE_FALLBACK`, and the failure is
logged at `warn`. Nothing about a successful response passes through the guard —
a payload that is not an error envelope never enters the decoration.

No exported signature changes. The behavioural change is visible to a host whose
`resolvePreferredLanguage` reads a gated port: that host now gets the envelope
plus a `warn` line instead of a bare Fastify error body.

`RequestLanguageDeps.adminPreferredLanguage`'s doc block is corrected in the same
change. It asserted that the dependency is supplied by the composition root
"rather than resolved as a port" precisely so it could not throw here; a host in
this repository has supplied it out of a gated port since the module packaging
work removed the named entity class it used to read. The dependency may throw,
and the guarantee is now stated at the renderer instead.
