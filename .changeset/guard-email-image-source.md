---
'@endora-commerce/email-components': patch
---

`renderEmailHtml` omits the entire image row for `EmailImage` and `EmailLogo` when a standalone variable source resolves to an empty value, instead of producing `<img src="">`.
