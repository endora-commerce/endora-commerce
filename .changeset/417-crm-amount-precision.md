---
'@endora-commerce/contracts': minor
---

An opportunity's `manualValue` (`CreateOpportunityRequestSchema` and the schemas that share its decimal-amount shape) refuses more than two decimal places with the platform's one precision code, `400 AMOUNT_PRECISION_EXCEEDED` (issue #417), rather than a `VALIDATION_FAILED` of its own. A value that is not a non-negative decimal at all is still `VALIDATION_FAILED`.
