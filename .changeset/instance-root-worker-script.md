---
'@endora-commerce/cli': patch
---

A new instance's root `package.json` declares `worker`, so the separate worker tier is started
with `pnpm run worker` from the instance root, beside `pnpm run start` for the API, and the
instance README's command block names it. The backend
member has always declared `worker`, and the queue-consumer documentation tells an operator to
split the consumers into their own process with it, but the root forwarded `start` and not
`worker`. An instance scaffolded before this release has no root `worker`: run
`pnpm -C backend run worker`, which is the same command, or add
`"worker": "pnpm -C backend run worker"` to the root `scripts`.
