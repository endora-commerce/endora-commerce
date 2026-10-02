---
'@endora-commerce/mod-admin-users': patch
---

`admin_users create` ended with *Sign in at the admin panel with the email + password above*, and no password is above: it is never echoed, and under `--password-stdin` it was never on the command line. The line now names the e-mail and says the password is the one you chose and is not printed.
