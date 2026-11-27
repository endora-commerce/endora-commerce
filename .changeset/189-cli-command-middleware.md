---
'@endora-commerce/cli': minor
---

The divergence report records command middleware (`specs/189-command-middleware/`, issue #1840). An overlay module's `commandMiddleware` manifest declaration becomes a `command-middleware:<module>:<id>` entry on rung 2, with its phase and action filter, and needs a reason in `divergence.ts` like any other divergence; a declaration that is not written as literals is a `computed-subject` finding. Two new findings check `commandMiddlewareOrder`: `stale-middleware-order` (an entry naming no `admit` contributor of the deployment) and `incomplete-middleware-order` (an entry naming one module of a tie and not the other). `endora generate` now refuses an instance in which an installed package that is not one of the release's first-party module packages declares `admit` middleware, which the platform would refuse at boot.
