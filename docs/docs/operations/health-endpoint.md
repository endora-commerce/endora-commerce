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
| `GET /api/v1/admin/platform-info` | Signed-in admins only. Returns `200` with `{ "version": … }`, the release described below. Checks no dependency. |

## The `version` field

The payload's `version` is the **Endora Commerce release** the instance runs — the version of
the `@endora-commerce/platform` package the server process loaded, for example `0.104.0`. Every
`@endora-commerce/*` package is released at one shared version, so that one number names the
release.

It is not the version in your instance's own `package.json`, and nothing you set in the
environment changes it. Before this was corrected the field read `npm_package_version`, which is
the host application's manifest version and is absent altogether when a container starts the
server with `node dist/index.js`; every deployment therefore reported `0.0.0`. If the platform
cannot read its own release, the field says `unknown` rather than a number.

The Admin UI shows the same number as a badge under the wordmark in the sidebar header. It reads
it from `GET /api/v1/admin/platform-info` — a signed-in admin's endpoint that answers
`{ "version": "0.104.0" }` (or `null`) without pinging any dependency — and not from this probe,
which answers `503` while a dependency is down. When the release is unknown the badge is not
shown at all. With the sidebar collapsed, the release is in the logo's tooltip.

## Use cases

- Container orchestrator readiness/liveness probe.
- Load-balancer health check for graceful drain.
- Synthetic monitoring.

## Extension points

Add new dependencies to the probe by extending the check list in
`packages/platform/src/http/health.ts`. Each probe should be cheap (single ping
/ `SELECT 1`) and bounded (≤ 200 ms timeout).
