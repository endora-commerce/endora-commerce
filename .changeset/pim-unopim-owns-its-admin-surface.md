---
'@endora-commerce/mod-pim-unopim': minor
'@endora-commerce/mod-i18n': minor
---

`@endora-commerce/mod-pim-unopim/admin` declares the module's screens

The `contributions` export gains `routes` and `nav` beside the three `zones` it already
carried. Seven routes — `/pim-unopim`, its four mapping screens, `/pim-unopim/runs` and
`/pim-unopim/runs/:runId` — and one sidebar entry in the `catalog` section at weight 400,
all gated on `pim_unopim:read`. Every route component is a dynamic-import factory whose
module has a default export, which is what the admin's registry loads.

An application composing this package no longer needs to register any of it. If you were
importing these screens from `admin/src/modules/pim_unopim/`, that directory is gone: the
seven pages, the admin API client (now `./admin`'s `api/unopim-client.js`), `format.ts` and
the section-tab, run-badge and issue-list components all ship inside the package. So do
`PimRunStatusBadge` and `PimIssueList`, which were briefly shared with
`@endora-commerce/mod-pim-ergonode` through a host directory; that module renders its own
badge, so these are `pim_unopim`'s. They are **not** exported — a second connector wanting
that chrome should get it from a published subpath rather than by reaching in.

`@endora-commerce/mod-i18n`'s shared bundle loses nine keys in both shipped languages: the
seven `appShell.nav.pimUnopim*` entries the host sidebar and its breadcrumb rules rendered,
which the module's own `nav.pimUnopim.label` replaces, and the two
`adminRoles.permission.pim_unopim:*` labels, which move into this module's own bundle where
a module's permission labels belong. No wording changed.
