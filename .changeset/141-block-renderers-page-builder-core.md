---
"@endora-commerce/page-builder-core": minor
---

New subpath `@endora-commerce/page-builder-core/contributions` — what a module package ships its Page Builder renderers in, and what a surface composes them with. Types `StorefrontContributions`, `StorefrontBlockConfig`, `PageBuilderBlockEditorConfig`, `BlockRenderFunction`, `BlockRenderEnvironment` and `BlockPresence`; `useBlockRenderEnvironment()` (the request language and the preview flag) with `BlockRenderEnvironmentProvider`; and the composition steps `withContributedBlocks`, `withPresence`, `isOwnerPresent`, `withBlockBoundary` (one failing block degrades to a placeholder, on the server and on the client), `fieldsFromDescriptor`, `editorConfigFromDescriptor` and `neutralBlockPreview`. Nothing existing changes.
