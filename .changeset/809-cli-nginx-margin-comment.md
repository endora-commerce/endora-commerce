---
'@endora-commerce/cli': patch
---

The comment above the storefront's proxy buffers in the generated `deploy/nginx.example.conf` no longer describes a quick-order preview cookie: since issue #809 the preview is kept by the backend, and nothing the storefront writes depends on nginx's default header buffers. The buffer lines themselves are unchanged.
