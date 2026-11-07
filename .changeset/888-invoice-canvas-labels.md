---
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-document-templates': patch
---

The invoice template editor's canvas draws what the PDF prints (#888). A label the template leaves empty is shown in the language of the tree being edited, from the invoices bundle's `pdf.*` keys. That covers the header title and dates, seller and buyer, the tax ID rows, the line-item and VAT-summary column headers, the totals and the default footer. A label the operator typed is shown as typed. The document-template editor now wraps its canvas in `BlockRenderEnvironmentProvider` with the edited language and `preview: true`, so a contributed block's `useBlockRenderEnvironment().language` is the edited tree's language and no longer always `en`.
