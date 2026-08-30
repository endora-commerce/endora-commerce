---
'@endora-commerce/contracts': minor
'@endora-commerce/admin-kit': minor
---

`LineChart` joins the admin icon allowlist.

`KnownIconNameSchema` gains `'LineChart'` and `resolveIcon` maps it to the lucide component
of that name — the pair AGENTS.md's command-palette checklist requires in one merge request,
because a name on the allowlist with no entry in the map renders the generic `Sparkles`
fallback.

It is added rather than substituted because a module's sidebar entry now declares its icon
by name (`AdminNavDeclarationSchema.icon` is this same enum). `analytics`' entry was a
direct `lucide-react` import in `admin/src/components/AppShell.tsx`; picking a name already
on the list would have changed the glyph an operator sees, which is a visible regression
bought for nothing.
