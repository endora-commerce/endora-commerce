---
'@endora-commerce/cli': minor
---

`endora new storefront` now tells its author which variables the copy reads to find a
backend, and exports the derivation that answers it.

The step used to read *"set `PUBLIC_API_BASE_URL` (and the rest of `.env.example`) to the
backend this storefront talks to. Nothing in the copy points at a backend."* Both
sentences were wrong. `PUBLIC_API_BASE_URL` is the **backend's** own variable — the public
origin its payment-gateway callbacks are built from — and no file in the storefront has
ever read it; and the copy does point at a backend, because every fetcher falls back to a
compiled-in `http://localhost:3001` when the environment names none. So an author who
followed the step had a storefront quietly talking to that address, with no error
anywhere to say so.

The step now names the variables the copy declares in its own `.env.example`, says that
the fetchers fall back rather than refuse, and says which of them Next inlines at build
time so they are set before `pnpm run build` rather than after.

**New exports**, for a consumer that needs the same answer — the acceptance criterion for
this command is the first:

- `backendAddressVariables(envExampleText: string): readonly string[]` — every
  declaration whose value is an absolute `http(s)` URL, in declaration order. Pure over
  text.
- `backendAddressVariablesOf(storefrontDir: string): readonly string[]` — the same answer
  read off a directory; a storefront with no `.env.example` answers with nothing rather
  than refusing.
- `ENV_EXAMPLE_FILE` — the file name both read.

Nothing is removed and no existing signature changes.
