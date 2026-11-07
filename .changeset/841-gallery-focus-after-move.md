---
'@endora-commerce/mod-catalog': patch
---

The product editor's gallery puts focus where a move or a removal ends even when the button is pressed right after the gallery renders: on the moved image's button for the same direction, or its other one at an end, and on the gallery heading after a removal. Before, an effect still pending from the earlier render could take the focus target too early, leaving focus on a button that the move had disabled.
