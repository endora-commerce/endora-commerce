---
title: health_checks
description: Liveness + readiness probe
---

# `health_checks`

Liveness + readiness probe.

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
`health_checks/routes.ts`. Each probe should be cheap (single ping / `SELECT
1`) and bounded (≤ 200 ms timeout).
