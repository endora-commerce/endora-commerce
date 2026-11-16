---
"@endora-commerce/mod-admin-users": patch
---

`admin_impersonation_reasons` gets the D-187 attribution check (`customer_account_id is null or organization_id is not null`), which the table was created without; a new migration adds it, and no existing row can violate it.
