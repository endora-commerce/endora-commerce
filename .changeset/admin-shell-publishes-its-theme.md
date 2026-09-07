---
'@endora-commerce/admin-shell': minor
---

The shell publishes its design tokens at a new subpath, `./theme.css`.

It carries the `@theme inline` block, the `:root` and `.dark` token
declarations, the `@layer base` rules and the 22-class `@layer components`
legacy shim — everything an admin project used to hold in its own `index.css`.
An instance now imports it and overrides a token by **redeclaring it after the
import**:

```css
@import "tailwindcss";
@import "@endora-commerce/admin-shell/theme.css";
@import "./tailwind.generated.css";

/* last, so a redeclaration wins */
:root { --primary: 262 83% 58%; }
```

That works because every semantic token is an indirection —
`--color-primary: hsl(var(--primary))` — so a utility this package's build never
saw resolves against the consumer's `:root`. What a redeclaration cannot change
is a value baked as a literal: the palette is overridable, Tailwind's spacing
scale is not.

**Why it matters to a consumer rather than to us.** The `@layer components` block
defines `.page-header`, `.badge--warning`, `.alert--error`, `.btn--primary`,
`.table` and eighteen others, and installed module packages *render* them. Held
in the consumer's own stylesheet, those definitions were frozen at the moment
their project was created: a module release adding `.badge--info` would have
rendered unstyled, in every existing project, with no error anywhere. They now
belong to the package whose components render them and arrive with an upgrade.

Additive: no existing subpath, export or symbol changes, and a project that does
not import it is unaffected.
