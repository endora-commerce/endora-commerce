---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-email': minor
---

`EmailMailerSendInput` gains an optional `replyTo`. The SMTP driver sends it as the `Reply-To` header and the console driver logs it beside the recipient; the recording mailer passes it to the transport and does not write it to the delivery record. Absent, every message is sent exactly as before.
