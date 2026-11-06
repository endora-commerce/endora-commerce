---
'@endora-commerce/cli': patch
---

The nginx examples a new instance is scaffolded with (`deploy/nginx.example.conf` and `deploy/nginx.paths.example.conf`) now give the storefront's `location` the same proxy buffer headroom as the repository's own example: `proxy_buffer_size 16k; proxy_buffers 8 16k; proxy_busy_buffers_size 32k;`, with the same comment. nginx's default buffers stay the contract; this is extra room for headers an operator adds. An existing instance can copy the three lines into its storefront `location` by hand.
