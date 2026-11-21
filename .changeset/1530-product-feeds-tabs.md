---
'@endora-commerce/mod-product-feeds': patch
---

The product feed's Settings and Delivery tabs are each one card of sections (UX audit CAT-20, issue #1530).

- **Settings:** the *Feed enabled* checkbox moved from a "Danger zone" section, where it was the only control, into the first section beside the name. The price display reads *Net* / *Gross* and the tax country has a label, instead of raw values. A gross feed with no tax country now says why it cannot be saved, under the field. *Saved* and a refused save are shown in the action bar beside *Save changes*.
- **Delivery:** the target, its history and *Stop delivering this feed* are three sections of one card, with the removal last. Delivery is switched on and off with a checkbox. Host and port, and user name and password, sit side by side on a wide screen. Help lines that repeated the field are gone or shortened, and the examples are placeholders. *Saved*, *Removed* and a connection test's result are shown beside the buttons instead of in a banner. The tab says it is loading instead of staying blank.
- **Overview, template import and templates list:** the link card and the import summary are labelled regions. A name clash on import is a group of the card, not a box inside it. The platform's templates are rows of one card instead of a card each, and their *Duplicate* is an outline button, so *New template* is the page's only filled button.
- **Template editor:** a field row's ⋮ menu is the kit menu, and *Move to position…* opens a dialog.

Removed `product_feeds` keys: `feeds.settings.danger`, `delivery.field.enabled`, `delivery.field.enabled.off`, `delivery.field.enabled.help` and `delivery.field.host.help`. An overlay that overrides them should override the new keys instead (`feeds.settings.presentation*`, `feeds.settings.taxCountry*`, `delivery.field.send`, `delivery.field.port`, `delivery.remove.*`).
