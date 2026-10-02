---
'@endora-commerce/cms-components': patch
---

`pnpm install` no longer reports four unmet `@tiptap/core` peers under `@endora-commerce/cms-components`. The package declared `@tiptap/extension-color`, `-highlight`, `-image`, `-text-align` and `-text-style` at exactly `3.31.3` beside `@tiptap/core`, `@tiptap/react` and `@tiptap/starter-kit` at `^3.31.3`. Every Tiptap package peers on its siblings at its own exact version, so once `3.31.4` was published a fresh install took the caret entries forward and left the pinned extensions asking for a core that was no longer installed. All eight are now `^3.31.3` and resolve together. Nothing to do on upgrade; a project that pins Tiptap itself should pin the whole family at one version.
