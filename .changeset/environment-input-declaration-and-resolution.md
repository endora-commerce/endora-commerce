---
'@endora-commerce/contracts': minor
'@endora-commerce/platform': minor
'@endora-commerce/cli': minor
---

Added the environment-input declaration, and the four-tier input resolution every
scaffolding command now shares.

**`@endora-commerce/contracts`** publishes the shape:
`EnvironmentInput`, `EnvironmentInputSchema`, `EnvironmentInputsSchema`,
`EnvironmentConsumer` / `ENVIRONMENT_CONSUMERS`, `EnvironmentRequirement`,
`EnvironmentInputOwner`, `LocalizedSentence`, and three predicates —
`isReadByAnyOf`, `scopeToMembers` and `isRequiredGiven`. One entry per environment
variable a running platform reads: what it configures, in both shipped languages;
whether it is `required`, `requiredWhen` another input holds a value, or `optional`
with a sentence saying **what is lost**; whether it is a secret; whether a command
may generate it; who owns it; and which trees read it.

There is deliberately **no `default` field**. A declaration that could carry one
would become another home for an invented value, which is what the provenance line
below exists to make impossible.

**`@endora-commerce/platform`** declares the 21 inputs the host and the platform
read, on a new `./env` subpath:

```ts
import { PLATFORM_ENVIRONMENT_INPUTS } from '@endora-commerce/platform/env';
```

The subpath is host-internal — declared, resolvable by a CLI and by the host, and
nameable by no module. A module declares its **own** inputs in its manifest, and the
shape it does so in is `@endora-commerce/contracts`'.

**`@endora-commerce/cli`** resolves those inputs, in one fixed order that is not
configurable: an explicit `--<input>` flag, then a `.env` already placed in the
target directory, then an interactive prompt, then a refusal. `endora new
storefront` takes it first, and writes the answers into the copy's own `.env`.

Three properties are contract rather than behaviour:

* **the tool invents no value.** Every run prints one provenance line —
  `[inputs] resolved: total=5 flags=5 env-file=0 prompted=0 generated=0 defaulted=0`
  — whose `defaulted` count is the *residue* of the four tiers rather than a counter
  nothing increments, so a value from outside them shows up in the arithmetic
  instead of disappearing;
* **no command blocks on a question nobody can answer.** A prompt is issued only
  when stdin and stdout are both TTYs, `--non-interactive` and `--dry-run` are
  absent and no CI marker is set. Otherwise a missing required input is exit `1`
  naming **every** missing input and the flag that supplies each, in one refusal;
* **the one class of value a command may generate is a cryptographic secret** whose
  declaration marks it `generable` — written into the target's `.env` where the
  operator can read it, named in the provenance line, and printed nowhere.

**If you call `runNewStorefront` directly**, it now resolves inputs and will refuse
a run that has none and cannot ask:

```diff
-await runNewStorefront({ dir: target, cwd });
+await runNewStorefront({
+  dir: target,
+  cwd,
+  inputs: { NEXT_PUBLIC_API_BASE_URL: 'https://api.example.com', /* … */ },
+});
```

`MissingInputsError` is the refusal; `DeclarationLoadError` is a tree whose
declaration could not be read, which is exit `2` rather than `1`. A target
directory holding nothing but a `.env` is now accepted, which is what makes the
second tier reachable for that command.
