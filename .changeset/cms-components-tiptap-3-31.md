---
'@endora-commerce/cms-components': patch
---

The optional Tiptap peers now require `3.31.3`. `@tiptap/core` up to `3.30.4` carries two
security advisories, one of them high, and the `@tiptap/extension-*` peers were pinned to
exactly `3.22.5`. Each of those extensions requires `@tiptap/core` at exactly its own version,
so the pin held every application that uses the rich-text blocks on the vulnerable core.

The peer ranges are now `^3.31.3` for `@tiptap/core`, `@tiptap/react` and
`@tiptap/starter-kit`, and exactly `3.31.3` for `@tiptap/extension-color`,
`@tiptap/extension-highlight`, `@tiptap/extension-image`, `@tiptap/extension-text-align` and
`@tiptap/extension-text-style`. **If your application declares these Tiptap packages itself**,
move all eight to `3.31.3` together. The extensions still require an exact match with
`@tiptap/core`, so a partial move installs two copies of the core. Nothing in the components'
API changes.
