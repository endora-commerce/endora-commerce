---
'@endora-commerce/mod-quote-requests': patch
---

The quote template editor's canvas draws a label the template leaves out in the language of the tree being edited, as the PDF prints it, and no longer in the administrator's language (#902). It reads that language from `useBlockRenderEnvironment()` and, when it is not the administrator's, loads that language's bundle. A label the operator typed is drawn as typed. In the editor this takes effect once the document-template editor provides the edited language to its canvas (#888).
