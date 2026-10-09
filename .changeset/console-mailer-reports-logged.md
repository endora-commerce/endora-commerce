---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-email': minor
'@endora-commerce/mod-transactional-emails': minor
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-payments': patch
'@endora-commerce/mod-shipments': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-newsletter': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-i18n': patch
---

An e-mail that was only written to the server log is no longer reported as sent. On an instance
with no `SMTP_URL` the console mailer logs the message and used to answer `{ status: 'sent' }`,
and the transactional e-mail service answered a constant `sent` of its own, so every module that
records or reports a delivery recorded one that did not happen.

**Breaking for a consumer of the two port types — three unions gain a member:**

- `EmailMailerSendOutcome` gains `{ status: 'logged' }`. The console mailer answers it instead of
  `sent`; the SMTP mailer and `InMemoryMailer` still answer `sent`.
- `TransactionalSendOutcome` gains `{ status: 'logged' }`, and `TransactionalEmailSender.send`
  passes the transport's `logged` on. A transport's `suppressed` (an already accepted message id)
  is still answered as `sent`, as before.
- `emailDeliveryStatusSchema` / `EmailDeliveryStatus` gain `'logged'`, and
  `invoiceEmailNotSentReasonSchema` / `InvoiceEmailNotSentReason` gain `'logged'`.

What to do: code with an exhaustive `switch` over one of these unions, or that passes
`outcome.status` into a closed union of its own, stops compiling until it handles `logged`; code
that reads `outcome.reason` after `outcome.status !== 'sent'` must narrow to
`outcome.status === 'suppressed'` first, because `logged` carries no reason. Code that compares
with `=== 'sent'` keeps compiling and now treats a logged message as not sent. `logged` is not a
failure and there is nothing to retry: the same call would log the message again. An own
implementation of `EmailMailerPort` or `TransactionalEmailSender` needs no change.

What changes on an instance without a mail server:

- `email_deliveries` rows are written with `status = 'logged'` instead of `'sent'`. The column is
  a plain `varchar(16)`, so there is no migration; rows written earlier keep `sent`.
- The order, return, payment-status, shipment and invoice e-mail results answer
  `{ sent: false, reason: 'logged' }`, each with its usual "was not sent" log line. Issuing an
  invoice or re-sending its e-mail from the Admin UI says the e-mail was not sent because no mail
  server is configured, in English and Polish (`invoices.emailNotSent.logged`).
- A CRM Event reminder is recorded as delivered to the bell alone — or as undeliverable when the
  bell is unavailable too — instead of "bell and e-mail".
- `POST /api/v1/organizations/register` answers `emailVerificationSent: false` when the
  verification e-mail went through the in-code builder and was only logged.

No setting, permission or migration changes.
