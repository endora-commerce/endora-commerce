---
"@endora-commerce/contracts": major
---

**Removed: the storefront theme catalogue.** `STOREFRONT_THEME_CODES`,
`StorefrontThemeCodeSchema`, `StorefrontThemeCode`, `DEFAULT_STOREFRONT_THEME_CODE`
and `isStorefrontThemeCode` no longer exist. Nothing on the wire changed:
`PublicSalesChannelSchema.themeCode` is the same `z.string().nullable()`, and the
create/update schemas still validate `^[a-z][a-z0-9_-]*$` — they never used the
enum.

**Why.** A storefront theme is a token set, and a token set can be published by
anyone: an ordinary npm package with a CSS file and an `endora: { themes: [...] }`
block. No set this package can compile is the whole set, so the list here was
always the list of *our* themes wearing the platform's name. The question moved
from "is this one of our themes" to "does this storefront have this theme", and
only a storefront instance can answer it — from the theme packages it has
installed and the token blocks its own stylesheet declares.

**What to do instead, per symbol.**

- `isStorefrontThemeCode` — ask *your* storefront, not this package. The
  reference instance generates a registry at build time and asks that:
  `storefront/lib/theme/instance-themes.ts`, over
  `storefront/lib/theme/themes.generated.ts`. Copy that shape; do not
  reintroduce a hand-written list, and in particular **do not** substitute an
  open predicate over the code regex — that makes every well-formed string a
  known theme, which deletes the unknown-code fallback and renders a typo'd
  channel unbranded.
- `DEFAULT_STOREFRONT_THEME_CODE` — an instance constant now. It is your
  storefront's choice, not the platform's, and it must be a member of your own
  registry.
- `StorefrontThemeCode` — `string`. The closed union is unrecoverable: no
  compiler can close a set a stranger extends after the compile. Replace the
  import with `string`, and replace the guarantee with a build check over your
  **emitted** stylesheet (`storefront/scripts/check-themes.mjs` is the reference
  one).
- `StorefrontThemeCodeSchema` — no replacement. Validate the shape, which is
  what the sales-channel write schemas in this package already do; do not
  validate membership server-side, or the field stops working for exactly the
  deployments it exists for.
- `STOREFRONT_THEME_CODES` — no replacement. An admin surface should render a
  free-text control: it is in a different deployment from the storefront, so any
  list it shows is advisory, and the storefront already answers a wrong value
  correctly.

Background: `specs/102-storefront-theme-discovery/`, owner ruling D-199.
`contracts/theme-package.md` is what a theme author reads.
