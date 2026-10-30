---
'@endora-commerce/mod-newsletter': patch
---

A subscriber's custom-field value is stored only when it matches the field's type.

- **Behaviour change:** the merge shared by the public `POST /api/v1/newsletter/subscribe`, the admin's subscriber create and the signed-in self subscribe used to keep any value whose key is a defined custom field, so a text could land in a number field. It now also checks the type — yes/no → a boolean, number → a finite number, date → an existing `YYYY-MM-DD` date, text → a string of at most 500 characters; `null` still clears a value — and drops a value that does not match. Nothing is refused: the request succeeds and the valid values are stored, as an unknown key was already dropped before.
