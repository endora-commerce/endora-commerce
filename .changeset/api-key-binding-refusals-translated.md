---
'@endora-commerce/mod-api-keys': patch
---

`403 API_KEY_NOT_BOUND` and `403 API_KEY_CHANNEL_MISMATCH` are answered in the caller's language.
Neither code had a bundle sentence, so the refusal was English whatever `Accept-Language` said.
The module's bundle now holds both in English and Polish; the English sentences read exactly as the
messages did ("This endpoint requires a distributor-bound API key.", "API key is bound to a
different sales channel."), and with `Accept-Language: pl` the answers are "Ten endpoint wymaga
klucza API powiązanego z dystrybutorem." and "Klucz API jest powiązany z innym kanałem sprzedaży."

The codes, the statuses and `details` are unchanged: neither refusal carries a value, so neither
sentence has a placeholder.
