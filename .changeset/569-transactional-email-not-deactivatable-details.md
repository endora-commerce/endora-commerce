---
'@endora-commerce/mod-transactional-emails': minor
---

`409 TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE` now carries the email's registry code as `details.emailCode`; `details.code` no longer carries it, and the error has no `details.code` at all. The owning module's reason is still `details.reason`. The code gains a sentence in English and Polish naming the email (`The "account_activation" email is always on and cannot be switched off.`), which is the message now — until now the envelope read the email code as a refusal token, found no sentence and answered the registry's English reason in every language. A client that read the email code from `details.code` reads `details.emailCode` instead; one that showed the message as the reason reads `details.reason`.
