---
'@endora-commerce/contracts': minor
---

`chargesByRate({ goods, charges, unit })` allocates order-level charges (delivery, the payment surcharge) over the goods' VAT rates (issue #904). It splits each charge's gross pro rata to the goods' net value per rate, in whole cents by largest remainder (a tie goes to the higher rate), and gives the whole charge to the highest goods rate when every goods line is 0.00. Each part's net comes from the row-target rule, so `vatByRate` over the goods and the parts gives each rate's row gross as goods row gross + charges wherever that gross can be produced. New types: `OrderChargeKind` and `ChargeByRate`.

Additive contract fields: `orderVatMethodSchema` / `OrderVatMethod` (`per_rate`, `per_rate_charges`); `orderChargeLineSchema` / `OrderChargeLine`; an optional `OrderRecord.chargeLines`; an optional `chargeLines`, `deliveryNet` and `paymentSurchargeNet` on `orderSchema`; and optional `deliveryNet`, `paymentSurchargeNet` and `vatRows` on `orderPreviewTotalResponseSchema` and on `adminOrderPreviewResponseSchema.summary`. The platform does not fill any of them yet.
