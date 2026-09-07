---
'@endora-commerce/contracts': major
'@endora-commerce/cli': major
'@endora-commerce/platform': patch
---

`EnvironmentInput` gains a required `addressOf`, and the CLI stops guessing which of a
storefront's variables names a backend from the shape of the value.

**Why.** Two programs ask *"which of these variables names the backend"* — `endora new
storefront`, whose next step tells an author to point them at theirs, and that command's
acceptance criterion, which does the pointing. Both answered it by reading
`storefront/.env.example` for a value that looked like an absolute `http(s)` URL. That is
right only while such a file declares no address but the backend's, and the reference
storefront now declares its **own** public origin (`NEXT_PUBLIC_SITE_URL`) there — so the
old predicate would have told a client, in a file they own outright and nobody revisits,
that the shop's canonical origin "names the backend this storefront talks to".

`addressOf` is a declaration of what a value **is**: which member of the instance it is
the address of, or `null` where it is the address of none.

**If you ship a declaration** — an application's `environment-inputs.mjs`, or the
platform's — every entry needs the field. It is required rather than optional on purpose:
an optional one is forgotten exactly once, by whoever adds the next address, in silence.
Zod refuses a declaration without it at `loadTreeDeclaration`, so the failure is a
sentence naming the entry rather than a variable that quietly stops being configured.

```diff
 {
   name: 'NEXT_PUBLIC_API_BASE_URL',
   requirement: { kind: 'required' },
   secret: false,
   generable: false,
   owner: { kind: 'application', application: 'storefront' },
   consumers: ['storefront'],
+  addressOf: 'backend',
 },
```

`null` is an answer and not an absence. A third party's address is `null` —
`DATABASE_URL` and `REDIS_URL` are addresses, of a database and a cache, and neither is a
member of the instance — and so is a value naming *several* origins, `CORS_ALLOWED_ORIGINS`
being the worked example: "the address of" is singular.

**`@endora-commerce/contracts`** adds `addressVariablesFor(inputs, member)`, the one
derivation both consumers take.

**`@endora-commerce/cli`** replaces `backendAddressVariables(envExampleText)` with
`addressVariables(declared, member)`, over a loaded declaration rather than over
`.env.example` text. `backendAddressVariablesOf(dir)` keeps its name and its meaning and
is now **async**, because it loads that directory's own declaration; there is a
`storefrontAddressVariablesOf(dir)` beside it. `envExampleDeclarations` and
`envExampleDeclarationsOf` are unchanged — the file is still the storefront's worked
example of its *values*.

```diff
-const names = backendAddressVariables(readFileSync('.env.example', 'utf8'));
-const names = backendAddressVariablesOf(storefrontDir);
+const names = await backendAddressVariablesOf(storefrontDir);
```

`STOREFRONT_DOMAIN` also becomes a per-instance build input in
`@endora-commerce/cli/lib/instance-build-inputs.js`, supplying the storefront build's
`NEXT_PUBLIC_SITE_URL`. A pipeline rendered from that declaration gains one
`--build-arg`; one that does not pass it builds a storefront whose canonicals, sitemap and
`robots.txt` name `http://localhost:3000`.

**`@endora-commerce/platform`** only annotates its own twenty-one declared inputs; no
exported behaviour changes.
