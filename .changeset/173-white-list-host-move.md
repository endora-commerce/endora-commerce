---
'@endora-commerce/mod-organizations': patch
---

`MinisterstwoFinansowClient` calls the White List at its new host, `wykazpodatnikowvat.mf.gov.pl`, by default (`specs/173-registration-registry-lookup/`, research R-6). The Ministry of Finance moved the service there on 2026-10-15 and serves the old `wl-api.mf.gov.pl` only until 2026-12-01, after which the admin "Validate now" for Polish NIPs would have answered `deferred` / `network_error` on every attempt. Paths and response bodies are unchanged; a `baseUrl` passed to the constructor still wins.
