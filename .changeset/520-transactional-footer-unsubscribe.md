---
'@endora-commerce/email-components': patch
---

Transactional e-mails no longer carry an empty Unsubscribe link (issue #520). The shared footer (`default_email_footer`) links to `{{var unsubscribeUrl}}`, a variable only newsletter sends set, so every transactional message rendered `<a href="">Unsubscribe</a>`. The `EmailFooterLegal` renderer now wraps that anchor in `{{if unsubscribeUrl}}…{{/if}}`, so it is dropped whenever the variable is empty or unset. This covers the seeded footer and any operator-edited copy, and needs no data change. Newsletter campaigns and automations, which always inject the URL, keep the link.

The plain-text part of an `EmailFooterLegal` block no longer contains raw HTML. Its anchors are written as "label: url", or as the bare URL when the URL is its own label, and every other tag is stripped. This changes the text part of newsletter messages too: the footer line now reads `Unsubscribe: https://…` instead of `<a href="https://…">Unsubscribe</a>`. A new export, `footerLegalPlainText` (`render/render-email-html`), is that conversion.

`defaultFooterTree()` is unchanged.
