---
'@endora-commerce/mod-price-lists': minor
---

*Pricing settings* is reachable, and read-only for a reader (feature 161, Checkpoint 10 rulings; Principle XVI, FR-028).

- New palette action `open-pricing-settings` → `/price-lists/display-modes` (`price_lists:read`), labelled "Pricing settings" / "Ustawienia cenowe". The price-book list's header links the page too.
- Old: every display-mode control showed for an operator holding only `price_lists:read`, and the server refused the write. This covered the page's default-mode selects, each override's mode select, *Remove* and *Add override*, and the override row in the organization and category zones. New: these controls render only with `price_lists:write`; a reader sees each value as text. An override's mode select is now labelled "Mode for {name}".
