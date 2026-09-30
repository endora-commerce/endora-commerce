---
"@endora-commerce/mod-email": minor
"@endora-commerce/mod-newsletter": minor
---

`mod-email` and `mod-newsletter` now require **`nodemailer` ^10** as a peer dependency, up from
^7. Install it beside them: `pnpm add nodemailer@^10`. Nodemailer 10 needs Node.js 20 or newer,
which the platform's own floor (22.17) already covers.

Nothing else about either package's API moves: `SmtpMailer` still takes an `SMTP_URL`, the
newsletter SMTP provider still takes host, port, `secure` and credentials, and both send the
same messages. What upgrading brings is nodemailer's security fixes since 7.0.13 — header and
SMTP command injection, linear-time address parsing, STARTTLS hardening among them.

`@types/nodemailer` is no longer needed: nodemailer 10 ships its own declarations. If your
application only installed it for these packages, you can remove it.

Behaviour an operator may notice after the upgrade, all of it nodemailer's rather than ours:

- **One SMTP error code is renamed.** "Authentication info was not provided", raised only when
  `SMTP_URL` sets `forceAuth` without credentials, now carries the code `ENOAUTH` instead of
  `NoAuth`. Its message is unchanged, and the e-mail delivery log and the newsletter provider's
  *Verify* result record the message rather than the code. Only log alerting that matches the
  code needs updating.
- **TLS certificates are validated when nodemailer fetches remote content** — an OAuth2 token
  endpoint or an HTTP(S) proxy named in `SMTP_URL` with a self-signed, expired or mismatched
  certificate now fails where it used to succeed. Neither package fetches attachment URLs:
  every attachment is handed to nodemailer in memory.
- **`SMTP_URL` is parsed more strictly.** A host the old parser silently truncated is now
  refused, and a colon inside the user name is kept.

This is `minor` rather than `major` only because both packages are in the `0.x` series, where a
minor already takes every `^0.x` dependent out of range; treat it as a breaking change for the
peer requirement.
