---
'@endora-commerce/cli': patch
---

`endora install` now moves the API to a free port when 3001 is taken, as it already did for the development services, the admin and the storefront. It used to report the busy port in the closing block and leave everything pointed at it, so on a machine that already runs something on 3001 the printed `dev:all` could not start the API. The chosen port is written as `PORT` into the instance's `.env`, and everything that names it follows: `VITE_API_BASE_URL` in `admin/.env`, the storefront's `NEXT_PUBLIC_API_BASE_URL` and `BACKEND_BASE_URL`, `PUBLIC_API_BASE_URL` where the instance declares it, and the closing block. A `PORT` you set in the target's `.env` before the run is used as written and never moved; if it is busy the run still says so. A loopback `--api-url` (`http://localhost:4000`) now also names the port the API listens on, as `--admin-url` and `--storefront-url` already did for their layers.
