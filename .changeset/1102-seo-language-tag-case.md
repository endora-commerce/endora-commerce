---
'@endora-commerce/mod-seo': patch
---

Issue #1102 — the SEO meta editor names a language scope by its tag as stored (`de-DE`) instead of upper-cased (`DE-DE`), in the "Use inherited" and "Discard unsaved changes" dialogs. This matches the catalog admin (#501). Display only: stored locales and the API are unchanged.
