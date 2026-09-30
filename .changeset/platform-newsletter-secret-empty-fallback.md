---
"@endora-commerce/platform": patch
---

An empty `NEWSLETTER_TOKEN_SECRET` now falls back to `SESSION_COOKIE_SECRET`, the same as an unset one.

`composeApp` read it with `??`, which keeps an empty string. Docker Compose hands a
container `''` for `${NEWSLETTER_TOKEN_SECRET}` when the `.env` line is blank, and the newsletter
module refuses an empty signing key, so a backend configured exactly as the examples describe
("leave it empty and the session key is used") exited 1 during `buildServer`. No action is needed
beyond upgrading; a deployment that sets the variable to a value is unaffected.
