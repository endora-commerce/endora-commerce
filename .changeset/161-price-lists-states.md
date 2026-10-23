---
'@endora-commerce/mod-price-lists': patch
---

Every editor screen states its loading and its failures (feature 161, T096; FR-032).

- The create flow's currency step shows a loading state and, when the currencies cannot be loaded, says so with *Try again*. Old: the step was empty, without saying why.
- On *Pricing settings*, the list-price setting's load failure offers *Try again* instead of asking for a page reload.
