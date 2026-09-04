---
sidebar_position: 1
title: Backend modules
---

# Backend modules

Each backend module owns a single business capability and never reaches into
another module's internals (Constitution Principle I). Where a module's code
lives is the platform's answer rather than a path worth writing down: most
modules are workspace packages under `packages/modules/<id>/`, a few are owned
by the host, and the [module map](./module-map.generated.md) names the package
that ships each one. The pages below describe each module so two audiences can
use them:

- **Developers** who need to extend the module — internal entities, services,
  and hooks they can plug into.
- **Product Owners** who need to understand *what* a module does and *which
  flows* it powers without reading code.

The OpenAPI document at `GET /api/v1/_openapi.json` is the live contract for
every HTTP surface listed here; see [API Contracts](../contracts/) for
how to consume it.

## Module map

The map is **generated** — one row per module the platform registers, with the
capability from each page's own `description` front matter and the package that
ships it. See [Module map](./module-map.generated.md).

## Reference pages

Beside every module's prose page the site carries a **reference page**, also
generated: the permissions the module declares and their labels, its command
palette actions and the route each opens, the settings it owns, whether an
operator can switch it off and what that control defaults to, what it depends
on, and the package that ships it. Every one of those is in the module's own
manifest, so the reference page is rendered from the manifest and from nothing
written by hand — which is why it cannot disagree with the platform. The
navigation reaches it from the module's own entry, and a module nobody has
written prose about yet has its reference page there under its id.

Write prose about what a module *does*; leave what it *declares* to the
reference page rather than restating it. A restated declaration is a sentence
that goes stale the next time somebody edits a manifest, with nothing to say so.

It is generated because it was wrong. Three hand-maintained lists described one
population — this table, the sidebar and the pages on disk — and all three
disagreed with the platform and with each other: 23 registered modules had no
row here, eight written pages were reachable from no navigation at all, and
nothing in the repository could see any of it. Adding a module now touches no
file under `docs/` but the module's own page.
