---
'@endora-commerce/platform': patch
---

Issue #997 — an audit entry written through `CommandBus.run` now carries the remote IP address, user agent and request id of the request in flight, the same three fields a direct `auditLogService.record` call takes from the request (`request.ip`, the `user-agent` header, `request.id`). Before, the composed bus had no request-metadata resolver, so every bus-written entry had all three `null`, and a write moved onto the bus (Principle XIII) silently lost its IP.

- `CommandBus` reads the metadata from the ambient platform scope by default; the request-scope hook fills it, and a worker, CLI, boot, interval or system scope leaves it empty. A scope opened inside a request answers for itself, so a worker scope never inherits a request's values, and concurrent requests never see each other's. `CommandBusOptions.getRequestMeta` still overrides the default.
- The IP is `request.ip`, so it follows the server's `trustedProxy` setting exactly as the direct path does: the socket peer unless a deployment names the proxy hop it trusts.

**Behaviour change on upgrade.** Audit rows written by Commands during an HTTP request gain `ip_address`, `user_agent` and `request_id`. Rows written before the upgrade stay as they are, and rows written outside a request still carry none. Nothing in the schema changes.
