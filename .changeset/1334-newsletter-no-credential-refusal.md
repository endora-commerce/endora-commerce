---
'@endora-commerce/mod-newsletter': minor
---

On a production instance (`NODE_ENV=production`), sending a newsletter campaign now needs a usable e-mail credential (issue #1334). A usable credential is the `newsletter.email_credentials` setting naming an `email_adapter` credential of the SMTP kind that resolves. Before, a campaign sent with no such credential went to the console sink: the messages were written to the server log, reached no mailbox, and the campaign still read as sent. An Amazon SES credential took the same path without saying so.

Now, when no usable credential is chosen:

- Sending a campaign is refused with `422 NEWSLETTER_PROVIDER_NOT_CONFIGURED`. The campaign keeps its status, and the reason is shown in the operator's language (English or Polish).
- The connection test on the Sending provider screen fails with the reason.
- A campaign or automation step dispatched after its credential was removed marks each recipient failed with the reason, instead of sent.

Development and test instances keep the console sink.

**What to do:** before upgrading a production instance that sends newsletters, choose an SMTP e-mail credential in the *Email credentials* setting.
