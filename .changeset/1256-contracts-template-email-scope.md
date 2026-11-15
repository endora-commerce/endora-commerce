---
'@endora-commerce/contracts': minor
---

`TemplateEmailPort.trySend` (container name `templateEmailPort`, owner `transactional_emails`) accepts the recipient's sales channel and language. Its input is now the exported type `TemplateEmailSendInput`, which adds two optional fields to the shape it had:

- `salesChannelId?: string | null` — render from that channel's content. Absent, `null`, or a channel that no longer resolves: the system-default channel.
- `language?: string | null` — render in that language. Absent or `null`: the resolved channel's default language, else `en-US`.

Additive: a caller that passes neither gets the system-default channel in its default language, as before.
