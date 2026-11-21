---
'@endora-commerce/page-builder-admin': minor
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-document-templates': patch
---

A page builder that is still loading now shows a skeleton of the builder — a toolbar over the blocks drawer, the canvas and the fields panel — instead of a grey sentence above an empty bordered box (issue #1540). The new `PageBuilderLoadingSkeleton` export is a polite `role="status"` region marked `aria-busy`, with its label as visually hidden text and its pulse off under `prefers-reduced-motion`. The CMS page, block and template editors, the blog editors and the document-template editor use it; the CMS editors now mount Puck once the block config is known, and a failed config read still shows the degraded canvas.
