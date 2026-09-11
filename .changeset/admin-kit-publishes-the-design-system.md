---
'@endora-commerce/admin-kit': minor
---

**`./theme.css` — the admin's design system now ships from this package**, and
it carries the class vocabulary as well as the tokens (owner ruling D-219,
`specs/110-instance-repository/contracts/admin-stylesheet-composition.md`
R3–R4).

**Old:**

```css
@import "@endora-commerce/admin-shell/theme.css";
```

**New:**

```css
@import "@endora-commerce/admin-kit/theme.css";
```

If your host also held `src/styles/design-tokens.css` and
`src/styles/components.css` and imported them from `main.tsx`, **delete both and
drop those two imports**: their content is in the file above. Keeping them
overrides the package, which is what the ruling removes.

The subpath moved here because this is the package every renderer already
declares — 55 module packages depend on it and none depends on the shell — so a
class name it publishes is one every renderer can put a version range on. It is
also the reason this is a `major` on both packages rather than a move nobody
notices.

**What is in the file.** 79 custom properties under one `:root`, the 22
`@theme inline` mappings that bind them to Tailwind utility names, `.dark`,
`[data-density="compact"]`, the `@layer base` rules, and the **200-token class
vocabulary** — `.b2b-*` and the page-builder classes — that host and module
admin surfaces render by name.

**The default palette changed**, and it is the one visible change in the
rendered output. The shell's `./theme.css` declared a shadcn slate palette that
this repository's own admin overwrote in full on every load; the merged file
declares one palette and it is the one that has actually rendered since the
rebrand. `--primary` is now `var(--accent-h) var(--accent-s) var(--accent-l)`
rather than a slate literal. To get the old palette, redeclare it after the
import.

**Overriding is unchanged and still needs no fork**: a redeclaration for a
value, a later rule for a class, both in your own stylesheet after the import.

```css
@import "@endora-commerce/admin-kit/theme.css";

:root { --accent-h: 262; }
.b2b-btn { border-radius: 2px; }
```

**23 classes were deleted rather than moved** — `.page-header`, `.card`,
`.field`, `.input`, `.btn`, `.alert`, `.badge`, `.table` and their modifiers,
the unprefixed `@layer components` shim. Measured over every class-attribute
position in this repository, no file that loaded them rendered one. If you
render any of them, define them yourself; the supported vocabulary is the
`.b2b-*` family and `@endora-commerce/admin-kit/ui`.
