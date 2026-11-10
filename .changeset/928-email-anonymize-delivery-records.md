---
'@endora-commerce/mod-email': minor
---

`email` registers `emailDeliveryAnonymizationPort` (issue #928). Every `email_deliveries` record addressed to the given address, compared case-insensitively, gets `recipient` set to `ANONYMIZED_EMAIL_RECIPIENT` and `subject`, `context` and `detail` set to `null`; the message id, kind, status, reason, channel, document reference and attempt time are kept. Each record it changed gets one `email_delivery.anonymized` platform audit entry with a null actor and no payload, in the same transaction. A repeat call finds nothing and records nothing; asking for the marker itself changes nothing. No event is published. The registration is a plain `ctx.di.register`, like `emailDeliveryRecorder`, because `email` is non-deactivatable.
