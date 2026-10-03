---
'@endora-commerce/platform': patch
---

The error envelope (`registerErrorEnvelope`) no longer tries to send a response on a reply that
has already been sent. An async handler that calls `reply.send()` without `return reply` makes
Fastify send twice; the second send's `ERR_HTTP_HEADERS_SENT` reaches the error handler, which
used to answer it with a 500 envelope that could not be delivered, so Fastify logged
`FST_ERR_REP_ALREADY_SENT` on top of the error that explains the defect. The handler now logs
the original error once, at `error` (`error after the reply was sent; nothing more was sent`),
and sends nothing. The double-send stays visible in the log; the caller keeps the first,
intact response.
