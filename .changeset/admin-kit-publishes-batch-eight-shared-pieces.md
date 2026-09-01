---
'@endora-commerce/admin-kit': minor
---

Publishes the five pieces feature 091's batch 8 had to drain before `seo`, `taxes`,
`credit_limits`, `delivery_methods`, `megamenu` and `returns` could own their admin
surfaces: `ProductPicker`, `CountryPicker`, `CurrencyPicker` and
`StatusTransitionGraph` on `./components`, and `statusBadgeStyle` /
`readableTextColor` on `./lib`. The two dictionary reads
(`listDictionaryCountries`, `listDictionaryCurrencies`) sit beside the pickers, as
the asset cluster's do.

Ten `cross-module-imports` keys retire on them — four into `catalog`'s picker, two
into `dictionaries`' country picker, two into its currency picker and two into
`orders` — of which four belong to modules this batch does not move (`orders`,
`quote_requests` twice, `inventory`). Each took the exit P2's three data pickers
took: the component builds its own request from the published `apiClient` and the
owner's `@endora-commerce/contracts` schema, so it holds no module code and
`admin-kit-surface.md` R6 permits it.

**Two of the five changed shape, and both changes are R-1's rule applied.**

`StatusTransitionGraph` no longer takes a `t` prop. Both callers passed
`useTranslation('core')` and the component read `orderStatusConfig.*` keys out of
it, so the prop carried the component's *own* copy through the caller rather than
the caller's vocabulary — which the `statusLabel` prop already carries. It resolves
those keys itself now, out of the `core` namespace they were already in, and the
rendered output is unchanged in both shipped languages. **If you rendered it**,
drop `t={t}`; nothing else about the call changes.

`orderStatusBadgeStyle` is published as **`statusBadgeStyle`**. A kit symbol named
after a module is R6 wearing a different hat, and the caller that made the
generality visible is `returns`, whose statuses are not orders'. The old spelling
survives as an alias at `admin/src/modules/orders/orderStatusColor.ts`.

`CountryPicker` and `CurrencyPicker` read `core` rather than `dictionaries` (R-1):
their six keys moved from that module's bundle into `_i18n`'s under the same
spelling. **If you translate this admin**, `dictionaries`' bundle loses the three
`countryPicker.*` and three `currencyPicker.*` keys and `_i18n`'s gains them,
plus five new `productPicker.*` — the four English sentences `ProductPicker`
carried as literals, which a component nobody had to translate looks like.

`CountryPicker` is **not** a duplicate of `CountrySelect`: this one reads the admin
dictionary, which serves inactive rows and groups them, so an operator can see that
a country exists and is switched off. `CountrySelect` reads the public facade,
which cannot answer that.
