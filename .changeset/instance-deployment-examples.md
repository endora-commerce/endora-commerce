---
'@endora-commerce/cli': minor
---

`endora new instance` writes example deployment files, and takes `--topology`.

A scaffolded instance was handed **no deployment file at all** — no compose file, no nginx
configuration, no `.env` for a running stack and no Dockerfile — while
`instance-repository.md` R2.1 listed three of them as always present. A client asked for the
owner's three-host topology wrote three deployment files from scratch.

It now writes a `deploy/` directory derived from two axes and nothing else: the resolved
member set, and `--topology single-host|three-host` (default `single-host`, an unrecognised
value exits 1 naming the vocabulary).

- `single-host` — `compose.prod.yml`, `.env.example`, `nginx.example.conf`.
- `three-host` — `three-host/compose.{backend,storefront,admin}.yml` with one
  `.env.<host>.example` each. Every stateful service is on the backend host; the one
  `depends_on` edge that crosses a layer boundary is dropped rather than translated, and
  nothing replaces it.
- Both — `deploy/README.md` and an example `Dockerfile` per image, whose every `--build-arg`
  and `ARG` is emitted from `instance-build-inputs.ts` rather than written.

The admin files are written only when the admin member is. The topology is recorded in no
file and read back by nothing: it selects which examples are written and the machine layout
stays the client's.

`nextSteps` now takes an optional third argument, the topology, and prints one additional line
under `three-host`. `PlanInput` gains a required `topology`; `NewInstanceOptions` gains an
optional `topology` string.

Normative: `specs/122-layer-deployment-independence/contracts/layer-independence.md` §3, under
owner ruling D-230.
