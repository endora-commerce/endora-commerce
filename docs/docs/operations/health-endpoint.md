---
title: Health endpoint
description: Liveness + readiness probe
---

# Health endpoint

Liveness + readiness probe.

It is the platform's, not a module's. Every Endora instance serves it
because it is an Endora instance: `@endora-commerce/platform` registers the
route from its own application composition, so there is nothing to install,
nothing to switch on, and no command that can take it away. It used to be a
module called `health_checks`, which meant a scaffolded instance — whose module
set is derived from the modules that declare themselves non-deactivatable — did
not have it, and its API container never became healthy.

This page lives in the site's own tree rather than beside a module's sources,
on the precedent of [Module Lifecycle](../modules/lifecycle.md), whose subject
is likewise a part of the platform package.

## Public surface

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/_health` | Returns `200` with a JSON status of Postgres, Redis, and Meilisearch reachability. Returns `503` if any dependency is unreachable. |

## Use cases

- Container orchestrator readiness/liveness probe.
- Load-balancer health check for graceful drain.
- Synthetic monitoring.

## Extension points

Add new dependencies to the probe by extending the check list in
`packages/platform/src/http/health.ts`. Each probe should be cheap (single ping
/ `SELECT 1`) and bounded (≤ 200 ms timeout).
