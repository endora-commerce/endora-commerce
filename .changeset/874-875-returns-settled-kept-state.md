---
'@endora-commerce/mod-returns': patch
---

The default refund of a return is now recomputed at settlement, from the cases already settled
(issue #875). The kept state is the return cases settled with a refund or a credit: a case that was
rejected, replaced or repaired takes nothing off it, and a complaint never enters it (issue #874).
A complaint settled with money is a price reduction of goods the buyer keeps, so it counts only
against what is left paid for the order and against the line it names. A case settled out of the
order it was opened in, or after an earlier case was rejected, therefore refunds what leaves the
kept-lines invoice and the corrected invoice equal to what is left paid, to the cent.

The figure an open case shows is provisional until settlement and may move by a cent or two. The
settlement prefill previews the recomputed figure. An approved amount equal to a default the case
showed settles at the recomputed default; a lower amount is kept as typed; a higher one is refused
with `422 VALIDATION_FAILED` (`refund_exceeds_paid`) and nothing written.

No order line refunds more than it was paid. A complaint and the returns of its line are bounded
by the line's value: a return after a complaint gets its full default until that bound binds, and
the operator lowers it by hand when the unit the complaint compensated is the one coming back. The
stored default stays the value of the goods that came back. The `return.settled` audit entry
records `recomputedDefaults` and `lineCeilings` when either applies.

`ReturnSettlementService` takes `orderContext` (`OrderReturnContextPort`) in its dependencies;
`returnsModule` wires it from the options it already receives.
