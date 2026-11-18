---
'@endora-commerce/mod-mfa': patch
---

The admin's own **Account security** screen (`/security`) is translated in full (issue #1481). Its title, description, status line, labels, buttons, recovery-code notice and error messages now have English and Polish text, and the page has a proper `h1` page header like every other screen. The *disable* and *regenerate recovery codes* forms each keep their own code — typing in one no longer fills the other — and a refused code is shown under the field that sent it. Every code field offers the browser's one-time-code autofill; the setup confirmation, which takes only an authenticator code, opens the numeric keyboard.
