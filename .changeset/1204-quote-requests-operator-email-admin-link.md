---
'@endora-commerce/mod-quote-requests': minor
---

The `quote_request_operator_submitted` and `quote_request_operator_resubmitted` e-mails link into
the admin panel (issue #1204, spec 179 OQ-1). With `ADMIN_BASE_URL` set, they send the new
variable `quote.adminUrl`. That is `<ADMIN_BASE_URL>/quote-requests/<id>`, the address of the bell
entry. The default templates, in English and Polish, show an **Open the quote request** /
**Otwórz zapytanie ofertowe** button to it. With `ADMIN_BASE_URL` unset the variable is not sent
and the button is left out. A relative or guessed link is never sent. A customised template that
does not name `quote.adminUrl` renders as before. The manifest declares the variable for the
template editor.
