---
"@endora-commerce/email-components": minor
---

`renderEmailHtml` and `renderEmailText` accept `blockRenderers` and `onBlockError`: renderers a module contributes for its own e-mail blocks, consulted only for a name no first-party block answers, so a first-party block is never overridable. A renderer that throws contributes nothing and is reported; its `defaultProps` are merged under the stored props; a renderer without `text` has its text derived from its HTML. New exports from `render/block-renderers`: `EmailBlockRenderer`, `EmailBlockRenderers`, `EmailBlockRenderContext`, `EmailBlockRenderingOptions`, `EmailBlockErrorHandler`, `EmailBlockFailure`, `EmailBlockFailureReporter`, `renderContributedBlock` and `emailBlockRendering`. `renderEmailText` also accepts `language` and `accentColor`, which it hands to contributed renderers. Without the new options both functions render exactly as before.
