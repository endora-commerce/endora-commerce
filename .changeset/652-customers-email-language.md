---
'@endora-commerce/mod-customers': minor
---

The customer's e-mail language, on the account page and on the admin customer screen (issue #652).

- New route `PATCH /api/v1/me/customer/preferred-language`, body `{ preferredLanguage }`: the signed-in customer's own choice. A language the request's sales channel offers is matched without regard to case and stored as the channel spells it, answering `{ data: { preferredLanguage } }`; any other answers `422 PREFERRED_LANGUAGE_NOT_OFFERED` ("This store does not offer that language." / "Ten sklep nie oferuje tego języka."). The route is unavailable (`503 MODULE_DISABLED`) while the module is switched off.
- `GET /api/v1/me/customer` and `GET /api/v1/admin/customers/:id` answer `preferredLanguage` (`null` while unknown).
- `POST /api/v1/customers/register` records the registering request's language on the new account.
- The admin customer detail shows an *E-mail language* row, read-only; *Not set — the store's default language is used* while the account has none.
