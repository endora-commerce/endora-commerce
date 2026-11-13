---
'@endora-commerce/email-components': minor
---

A button whose address is one `{{var path}}` directive and nothing else is now left out of the HTML
and the text part while that variable is empty or unset. Before, the HTML part rendered a button
pointing at `#`, and the text part rendered the label with no address. A button with a literal
address, or one that only contains a variable (`https://example.com/{{var id}}`), renders as before.

`renderEmailHtml` and `renderEmailText` apply it at render time, so a seeded template and an
operator-edited one behave alike. `guardLoneVariableHref(href, rendered)` from
`@endora-commerce/email-components/render/render-email-html` is the shared helper. It wraps
`rendered` in `{{if path}}…{{/if}}` when `href` is the lone variable `path`.
