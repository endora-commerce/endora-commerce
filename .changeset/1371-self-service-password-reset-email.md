---
'@endora-commerce/mod-organizations': patch
---

A customer who asks for a password reset on the storefront now receives the reset e-mail (issue #1371). The request minted a reset token and answered 202, but nothing mailed the link, so a customer who forgot the password could not get back into the account. The link opens `/password-reset/confirm` on the storefront of the request's sales channel (its `sales_channels.storefront_url`, else `STOREFRONT_BASE_URL`), under the prefix of the channel language the request resolved to, and the e-mail is written in that language.

The message is a new transactional e-mail, `customer_password_reset`, with English and Polish default content, editable under **Transactional emails** like every other customer e-mail. It cannot be switched off, because it is how the customer gets back into the account. A plain English message is sent when no template definition exists. The answer stays 202 whether or not an account has the address, and the request throttle is unchanged.
