---
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-document-templates': patch
---

Polish invoice PDFs no longer print English labels (issue #437). The invoice document type's built-in layout carried English literals in its label props (*Issue date*, *Sale date*, *Payment due*, *Payment method*, *Seller*, *Buyer*, the VAT summary's *Total*, and the totals block's *Paid*, *Amount due*, *Total* and *In words*) and in its footer text (*Thank you for your business.*). A label prop wins over the translation, so an invoice, proforma or correction printed with that layout said *Paid* where it should say *Zapłacono*. Every one of these props is empty in the built-in layout now (`GENERIC_INVOICE_TEMPLATE_SEED_REVISION` 3), and an empty prop is drawn in the document's language. The footer follows the labels: an empty or blank footer text prints the default footer in the document's language. Until now it printed an empty footer, while the editor's canvas already showed the default.

`Migration20261107T110328DocumentTemplatesInvoiceSeededLabels` (`mod-document-templates`) does the same to stored invoice templates. In every language layout of every `invoices.invoice` template, it empties a prop only where the prop holds **exactly** the English literal the built-in layout seeded, and it advances `version` on each template it changes. Every other value stays as it is: a translated label, a reworded one, or a footer with a line added. Other document types are untouched.

**Behaviour change on upgrade.** If an invoice template kept a seeded English label because you wanted English on Polish invoices, the label prints in Polish after the upgrade. Type the English label into the block again to keep it. The same applies to the English sample footer.
