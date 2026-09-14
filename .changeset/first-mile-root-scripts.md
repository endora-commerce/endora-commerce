---
'@endora-commerce/cli': minor
---

The root scripts that drive the development environment, and a next-steps block that is four
lines shorter than the sequence it replaces.

`endora new instance` now declares `dev:services` and `dev:services:down` (the `compose.dev.yml`
this command writes, with `--wait` so `migrate` cannot race an initialising Postgres), the
composite `setup` — `generate && build && migrate && module:install --all`, derived from those
named root scripts rather than spelled out, so a change to one of them reaches it with nothing
edited — and `preview:admin` with the admin member, which serves the bundle `build:admin`
produced and which no root script and no printed step had ever named.

`nextSteps()` takes a fifth argument, an options object carrying whether the admin member was
written, the addresses read off the rendered `compose.dev.yml` and the mail catcher's URL. The
block prints the services step first, names what `setup` runs so any step can still be taken by
hand, and prints the development addresses rather than writing them — writing them into `.env`
is FR-105 and waits on a ruling. `endora new storefront`'s block gains `pnpm run start`, which
that manifest has declared all along and which was printed nowhere.
