---
'@endora-commerce/cli': minor
---

Publish the two derivations a caller needs to supply `endora new storefront` with
the inputs it requires.

Since the storefront's invented defaults went, the command resolves five required
inputs in four tiers and refuses a non-interactive run that supplies none. A
caller that has to *supply* them needs the same population the command will
*demand*, and deriving it a second time is two answers waiting to disagree —
which is how this repository's own acceptance criterion came to invoke the
command with no inputs at all.

Three additions, all additive:

```ts
import {
  storefrontDeclaredInputs, // the reference storefront's declaration,
                            // scoped to the one member the command writes
  envExampleDeclarationsOf, // every declaration that copy's `.env.example` makes
  flagFor,                  // SESSION_COOKIE_SECRET -> --session-cookie-secret
} from '@endora-commerce/cli';

const declared = await storefrontDeclaredInputs(repoRoot);
const example = envExampleDeclarationsOf(referenceDir);
const argv = [flagFor('BACKEND_BASE_URL'), example.get('BACKEND_BASE_URL')];
```

`storefrontDeclaredInputs` deliberately does not filter by requirement:
`isRequiredGiven` reads a conditional requirement against the values a run has in
hand, so which inputs are required is a property of the invocation rather than of
the declaration.

`envExampleDeclarations` / `envExampleDeclarationsOf` are the parser
`backendAddressVariables` already ran, now named and exported —
`backendAddressVariables` is defined over it, so the two questions asked of that
file cannot come to disagree about what it says. One behaviour changes at the
edge: a key whose **last** assignment is blank is no longer a declaration, in
either answer. That matches `inputs/env-file.ts`, where a blank value does not
resolve an input.
