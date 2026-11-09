---
'@endora-commerce/mod-customer-accounts': minor
---

Account custom-field values at creation and on anonymisation (`specs/175-buyer-input-custom-fields/`).

- `CustomerAccountMemberWritePort.create` stores `CustomerAccountCreateInput.customFieldValues` as given (`{}` when absent). The bag is already validated by the caller through custom_fields' value port — the registration surface or the admin member create — and is not re-validated here.
- `CustomerAccountLifecycleWritePort.anonymize` clears the account's whole custom-field bag beside the other scrubs. The `customer_account.anonymized` audit row keeps `before: { email }` and the `customer_account.anonymized.v1` event stays ids-only, so neither carries a custom-field value.
