---
'@endora-commerce/mod-cms': patch
---

The CMS page editor asks for a page's name, slug and description once. The *Page metadata* and *Language version* cards are now one card that edits the language the canvas shows: in the page's first language, while it has no translation of its own, its fields are the page's own values; in any other language an empty field falls back to the page's own value, shown as a hint. The card no longer has its own language tabs; the tabs above the canvas switch both. It shows one public address and one reserved-slug warning. The meta title, description and keywords are in a collapsed *SEO* section. The status is a badge beside the page title instead of a disabled select. A new page's slug follows its name, and a typed slug is normalised when the field is left; a saved page keeps its address when renamed.
