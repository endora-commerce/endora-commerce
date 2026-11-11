---
'@endora-commerce/mod-customer-accounts': minor
---

Account custom-field values at creation (`specs/175-buyer-input-custom-fields/`).

- `CustomerAccountMemberWritePort.create` stores `CustomerAccountCreateInput.customFieldValues` as given (`{}` when absent). The bag is already validated by the caller through custom_fields' value port — the registration surface or the admin member create — and is not re-validated here.
