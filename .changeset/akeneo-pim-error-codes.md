---
'@endora-commerce/contracts': minor
---

Add Akeneo PIM transport error codes and `PimErgonodeConnectorActivityPort`.

`ERROR_CODES` gains `PIM_AKENEO_NOT_CONFIGURED`, `PIM_AKENEO_CONNECTION_DISABLED`,
`PIM_AKENEO_BOOTSTRAP_INCOMPLETE`, `PIM_AKENEO_DELIVERY_ID_CONFLICT`,
`PIM_AKENEO_CHANNEL_REQUIRED`, `PIM_AKENEO_SECRET_REQUIRED`, and the shared
`PIM_CONNECTOR_ALREADY_ACTIVE` used when enabling Akeneo while another PIM
connector is already on.

`PimErgonodeConnectorActivityPort` is the gated read Akeneo uses for that
check (`pimErgonodeConnectorActivityPort`). Additive; existing Ergonode codes
are unchanged.
