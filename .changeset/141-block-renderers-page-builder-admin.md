---
"@endora-commerce/page-builder-admin": minor
---

The e-mail editor draws a module's contributed e-mail block with the renderer the send path runs. `EmailEditorPane` loads the `email` block contributions of the present modules, shows each on the canvas and in the HTML preview, and gives a declared block with no contributed renderer an editor built from its declared fields. A stored block the editor cannot render — a switched-off module's — is now a visible placeholder that keeps its props; it used to be drawn as nothing. New exports from `./email`: `emailBlockEditorConfig`, `composeEmailBlocks`, `loadEmailBlockRenderers`, `EmailBlockRenderersProvider`, `useEmailBlockRenderers` and their types. The pane must be rendered under `AdminContributionsProvider`, which the admin shell already mounts.
