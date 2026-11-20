---
'@endora-commerce/mod-megamenu': patch
---

The megamenu list's active-scopes badge now uses plural forms (UX audit follow-up, issue #1567). Before, Polish showed "{count} zakresów" for every count, so two scopes read "2 zakresów". `list.activeScopes` is now a family of `.one` / `.few` / `.many` / `.other` keys in both bundles, picked with `Intl.PluralRules`, as the tree's nested-item question already does. Polish now reads "1 zakres", "2 zakresy" and "5 zakresów". An overlay that overrides `list.activeScopes` must override the four suffixed keys instead.
