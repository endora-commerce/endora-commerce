---
'@endora-commerce/contracts': minor
---

Add `NEWSLETTER_HOOKABLE_ACTIONS` (`subscribe`, `resubscribe`, `confirm`) with the data types
`NewsletterSubscriberHookData` and `NewsletterSubscriberOutbox` (issue #1843). The actions are
`newsletter_subscriber.subscribe`, `newsletter_subscriber.resubscribe` and
`newsletter_subscriber.confirm`. A module registers
a command hook against them as it does against `ORGANIZATION_HOOKABLE_ACTIONS`:

```ts
import { NEWSLETTER_HOOKABLE_ACTIONS as NL } from '@endora-commerce/contracts';

ctx.commandHooks([{ id: 'grant-code', on: NL.subscribe, phase: 'afterCommit', handler: grantCode }]);
```

The data carries ids and codes only: `subscriberId`, `status`, `previousStatus`, `salesChannelId`,
`customerAccountId`, `organizationId` and `tagIds`. It never carries the e-mail address or a token.
