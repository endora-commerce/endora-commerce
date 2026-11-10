---
'@endora-commerce/mod-assets-library': patch
---

Issue #815: a time-limited S3 or GCS URL for a private asset is now signed with the asset's stored type and the serving policy's disposition (S3 `ResponseContentType` / `ResponseContentDisposition`, GCS `responseType` / `responseDisposition`), and `?download=1` on the file route asks for an `attachment` there as it does on local storage. The bucket therefore answers with those headers whatever the object's metadata says. The change is internal to the module's storage adapters; no exported shape changes, and public URLs are unchanged.

A bucket response still cannot carry `X-Content-Type-Options: nosniff`; the module page now documents adding it at a CDN or load balancer in front of the bucket and serving the bucket from an origin that shares no cookies with the API or the admin.
