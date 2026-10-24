---
'@endora-commerce/contracts': patch
---

The money-input grammar (issue #417, review of PR #423): trailing zeros are not significant — an ERP integration's `"123.4500"` is a valid 123.45 — and only a significant digit beyond the second place is refused with `AMOUNT_PRECISION_EXCEEDED`. A string that is not a decimal at all (`""`, `"abc"`, `"1e3"`, `"+5.00"`, `"1 234,56"`) is refused with a format issue under `VALIDATION_FAILED`, never with the precision code. `twoDecimalAmountString(schema, { pattern, message })` takes the format to check first; an opportunity's `manualValue` uses it, so a malformed value carries its one format issue and no precision issue on top.
