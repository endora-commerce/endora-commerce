---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-seo': patch
'@endora-commerce/mod-price-lists': patch
---

The product editor has one heading outline: the page `h1`, each tab's sections as `h2`, their sub-sections as `h3`, with no level skipped (issue #1490, UX audit CAT-11).

`@endora-commerce/mod-catalog`: the Scope map tab no longer opens with a "Scope map" `h3` that repeated the tab's name. The map is an `h2` section, *Values by channel and language*, with the help line as its description, and *No longer applies* (an `h4` before) is the `h2` section after it. A reset still returns focus to the map's heading. A content attribute's card on the Attributes tab captions its label like the fields beside it instead of using an `h3` with no `h2` above it. A bundle slot's heading is an `EditorSection` at `h3`, styled like every other sub-section.

`@endora-commerce/mod-seo`: the SEO tab no longer opens with an "SEO meta tags" heading. Its fields are two `h2` sections, *Search results* (title, meta description) and *Social sharing* (the Open Graph fields). The `productSeo.title` message is removed.

`@endora-commerce/mod-price-lists`: the Pricing tab's *Base prices* and *Price books pricing this product* are `EditorSection`s divided by a rule, like the other tabs' sections, instead of headings with extra space above the second one.
