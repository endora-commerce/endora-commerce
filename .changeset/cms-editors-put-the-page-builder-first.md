---
'@endora-commerce/mod-cms': patch
---

The CMS page, block and template editors put the Page Builder first.

The metadata card and the scope card used to sit in a row above the canvas, so every visit to an
editor began by scrolling past them. They are now a settings panel beside the canvas — a column to
its right from 1536 px of viewport, a block above it below that — and a **Hide settings / Show
settings** button over the canvas puts the panel away to give the builder the full width. The
choice is remembered per browser.

The panel opens by itself where it is needed: for a new page, block or template, which cannot be
saved without a name and a scope, and whenever a save is refused, so a validation error is never
behind a collapsed panel. The content language tabs moved to sit directly above the canvas they
switch.

Nothing about what is saved changed — the same fields, the same requests. No exported symbol
changed either: the shell is the module's own and `@endora-commerce/mod-cms/admin-ui` still
publishes only `PageBuilderEditor`, so the blog editors that render that canvas are untouched.
