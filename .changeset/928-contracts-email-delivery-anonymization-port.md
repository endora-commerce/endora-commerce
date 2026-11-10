---
'@endora-commerce/contracts': minor
---

New port `EmailDeliveryAnonymizationPort` (container name `emailDeliveryAnonymizationPort`, owner `email`) with one method, `anonymizeForRecipient(recipient): Promise<number>`, and the constant `ANONYMIZED_EMAIL_RECIPIENT`: the customer-account anonymisation sweep's step that scrubs the delivery records of the e-mails sent to the account's address, answering how many records it changed (issue #928). Additive; nothing existing changes.
