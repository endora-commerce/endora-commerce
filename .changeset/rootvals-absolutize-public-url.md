---
'@endora-commerce/platform': patch
---

`kernel/public-api-base-url.ts` gains `absolutizePublicUrl`, which makes an asset or API path
absolute for a consumer that is not a browser on this host.

It is **not** on the `./kernel` barrel and is not public API: no module reaches it, and its
only caller is the composition root, for the PWA asset bridge and the transactional-email
asset URL. It arrived from `backend/src/modules/email/`, where it was filed under the module
that first needed it and had no consumer inside that module at all.

Its default base is still `BACKEND_PUBLIC_URL ?? PUBLIC_API_BASE_URL`, deliberately rather
than `configuredPublicApiBaseUrl` beside it: the two disagree on precedence when both
variables name different origins, so unifying them would move a URL rather than move a file.
