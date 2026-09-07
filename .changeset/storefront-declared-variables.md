---
'@endora-commerce/cli': minor
---

`declaredVariablesOf(storefrontDir)` — every variable a storefront's own process reads,
off its own declaration.

**Why a third derivation over the same file.** `backendAddressVariablesOf` and
`storefrontAddressVariablesOf` answer *which of these names a member*, a subset chosen by
`addressOf`. This one is the whole population, scoped with `scopeToMembers` to the member
that runs there, and it is for a caller that **spawns** a storefront's toolchain rather
than one that configures it.

That caller exists, and the reason it needed this is worth stating: Next loads a `.env`
and does **not** override a variable the process already carries. So any of these names
present in a parent's environment silently displaces the value written into the copy's own
`.env` — and a harness that passed its environment on wholesale measures its own
configuration while reporting on the command's.

```ts
import { declaredVariablesOf } from '@endora-commerce/cli';

const declared = await declaredVariablesOf('/tmp/instance');
// -> the names this storefront's process reads, in declaration order
```

The measured case was `NODE_ENV`. `endora new storefront`'s acceptance criterion inherited
its own environment into the instance's install, build and boot; a CI job set
`NODE_ENV=development` job-wide and correctly, for the **backend** it booted; and
`next build` inlines `process.env.NODE_ENV` as `"production"` into the server bundle it
emits while the render worker reads the real one — two copies of Next's vendored pages
runtime, two `React.createContext()` calls, and an `<Html>` looking for a provider
installed on the other one. The build failed with
*"`<Html>` should not be imported outside of pages/_document"*, which names nothing true,
in every CI run that criterion has ever had. Nothing of this repository's is involved: a
four-file `app/` fails identically. What the repository *can* do is stop handing a client's
build an environment that is not the client's, and this is the derivation that makes the
population the storefront's own declaration rather than a list of variable names somebody
maintains.

Additive. No existing export changes shape.
