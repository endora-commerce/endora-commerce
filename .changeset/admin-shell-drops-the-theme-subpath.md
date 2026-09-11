---
'@endora-commerce/admin-shell': minor
---

**`./theme.css` is withdrawn from this package.** It is now
`@endora-commerce/admin-kit`'s (owner ruling D-219).

**Old:**

```css
@import "@endora-commerce/admin-shell/theme.css";
```

**New:**

```css
@import "@endora-commerce/admin-kit/theme.css";
```

The import fails loudly rather than silently — `ERR_PACKAGE_PATH_NOT_EXPORTED`
at the first build — so there is nothing to notice later.

Nothing else about this package changes: it still peer-depends on the kit, and
the kit's `./theme.css` is what its own screens render against. The subpath
moved because 55 module packages declare the kit and **none** declares this
package, so classes published from here would have been rendered by packages
that cannot name their definer and cannot put a version range on it.

`@endora-commerce/admin-kit`'s own changeset says what is in the file, what the
new default palette is and how to override it.
