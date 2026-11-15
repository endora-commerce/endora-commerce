---
'@endora-commerce/mod-transactional-emails': patch
---

`templateEmailPort` renders a template in the sales channel and language its caller names (`TemplateEmailSendInput.salesChannelId` / `language`), falling back to the system-default channel for a missing or deleted channel and to the channel's default language for a missing language. A caller that names neither is unchanged.
