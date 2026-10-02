# The storefront

The customer-facing shop of an Endora Commerce installation: a Next.js application that renders
catalogue, product, cart, checkout and account pages on the server, from an Endora Commerce API.
It holds no data of its own. It is its own repository, deployed on its own, and it talks to the
API over HTTP and nothing else.

## Its values

They are in `.env`, beside this file. `environment-inputs.mjs` declares each one and says what it
decides.

| | | |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | where a **browser** calls the API | build time |
| `NEXT_PUBLIC_SITE_URL` | this storefront's own public address: canonical links, the sitemap and `robots.txt` are built from it | build time |
| `NEXT_PUBLIC_SALES_CHANNEL_CODE` | the Sales Channel it sells on | build time |
| `BACKEND_BASE_URL` | where this storefront's **own server** calls the API — the same API, reached from this machine | run time |
| `REVALIDATE_SECRET` | the value the API holds under the same name; it is how the API asks this storefront to refresh a cached page | run time |
| `PORT` | the port it is served on. Absent, 3000 | run time |

Next.js writes every `NEXT_PUBLIC_*` value into the bundle when it builds, so changing one means
`pnpm run build` again, not a restart. The other three are read when the server starts.

Two of them have to agree with the API's own `.env`: `REVALIDATE_SECRET` is the same value on
both sides, and the API's `CORS_ALLOWED_ORIGINS` and `STOREFRONT_BASE_URL` name the address in
`NEXT_PUBLIC_SITE_URL`.

## Running it

```
pnpm install
pnpm run dev                          # the development server, rebuilding as you edit
pnpm run build && pnpm run start      # the production build, then the server that build emits
```

Both servers listen on `PORT` from `.env`. The API has to be running: every page is rendered
from it, and a page whose API does not answer is an error page.

`pnpm run start` serves what `pnpm run build` produced and nothing older, so build first. The
build is a standalone one — a self-contained server under `.next/standalone/` — which is also
what `Dockerfile` puts in the image.

## Changing how it looks

`THEMING.md` is the guide: a token theme per sales channel with no rebuild, and what a fork of
this directory keeps and gives up.
