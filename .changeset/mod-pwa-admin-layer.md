---
'@endora-commerce/mod-pwa': minor
'@endora-commerce/contracts': minor
'@endora-commerce/admin-kit': minor
---

`pwa` ships an admin surface that is a sidebar entry and nothing else.

`@endora-commerce/mod-pwa/admin` is a new subpath exporting `contributions` — an
`AdminContributions` object with **one `nav` entry and no `routes`**. That combination is
legal and was, until now, unexercised: the type's own documentation says *"a module shipping
only a nav entry pointing at a host route is legal"*, and every conversion before this one
moved a route. The entry advertises `/settings/pwa`, labelled `nav.pwa.label` in this
package's own `i18n/{en,pl}.json` rather than in the shared bundle, in section `system` at
weight 1400, gated on `pwa:read`.

Two things a consumer has to know:

- **The screen at that path is not in this package.** `PwaPage` lives in the admin
  application, under a directory `settings` owns, so the route is still declared by the host.
  A consumer that renders the registry's nav without the admin's own route table will show an
  entry pointing at a path it does not serve. That resolves when `settings` ships its own
  admin layer.
- **`Smartphone` joins the icon allowlist.** `KnownIconNameSchema` gains the name and the
  kit's `resolveIcon` maps it to the lucide component of that name — the pair AGENTS.md's
  command-palette checklist requires in one merge request, because a name on the allowlist
  with no entry in the map renders the generic `Sparkles` fallback. It is added rather than
  substituted so the sidebar keeps the glyph it already drew.
