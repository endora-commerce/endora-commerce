---
'@endora-commerce/mod-api-keys': patch
---

`403 API_KEY_OUT_OF_SCOPE` names the missing scope in `details`, and is answered in the caller's
language. The refusal's message — "API key lacks the required scope: catalog:write." — was the only
place the scope appeared, so an integration had to cut it out of prose, and the code had no bundle
sentence at all, so the answer was English whatever `Accept-Language` said.

The error now carries `details.requiredScope`, and the module's bundle holds a sentence in English
and Polish that interpolates it. The English sentence reads exactly as the message did; with
`Accept-Language: pl` the answer is "Klucz API nie ma wymaganego zakresu: catalog:write."

`details` names the scope the route requires and nothing else — not the key, and not the scopes it
does hold; those stay in the `api_key.out_of_scope` audit row. The code and the status are
unchanged.
