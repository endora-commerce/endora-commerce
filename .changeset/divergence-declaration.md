---
'@endora-commerce/contracts': major
'@endora-commerce/platform': patch
'@endora-commerce/cli': patch
---

The per-deployment declaration is `divergence`, and it is an object (D-205).

`ReducedDeploymentDeclarationSchema` and its `ReducedDeploymentDeclaration` type
are gone. The entry survives as `OmittedModuleSchema` / `OmittedModule`,
unchanged in substance — a `moduleId` and a 20–800 character `reason` — and it
now sits inside `DeploymentDivergenceDeclarationSchema`, which is what a
deployment's `backend/src/apps/<deployment>/divergence.ts` exports as
`divergence`.

Before:

```ts
import type { ReducedDeploymentDeclaration } from '@endora-commerce/contracts';

export const reducedDeployment: ReadonlyArray<ReducedDeploymentDeclaration> = [
  { moduleId: 'blog', reason: '…' },
];
```

After:

```ts
import type { DeploymentDivergenceDeclaration } from '@endora-commerce/contracts';

export const divergence: DeploymentDivergenceDeclaration = {
  omittedModules: [{ moduleId: 'blog', reason: '…' }],
  decorationOrder: {},
  reasons: {},
};
```

The file is renamed with the export, because *reduced* encodes a direction two
of the three new contents do not have: `decorationOrder` declares the wrapping
order for a registration more than one of a deployment's overlay modules
decorates, and `reasons` carries one sentence per divergence the platform
derives, keyed by the derived entry's own key. Both parse today and are read by
nothing yet — they are supplied and checked by later phases of
`specs/107-override-report-and-ladder/`.

Three details a consumer will meet:

- Every field defaults to empty, so a declaration that leaves one out means
  "none of these" — the reading an absent file already gets.
- The object is **strict**: a fourth field, or a misspelled one, is refused
  rather than stripped, because a stripped field reads as "this deployment
  declares nothing" for a file whose author wrote a declaration.
- `@endora-commerce/platform`'s D-101 boot refusal is unchanged in behaviour and
  changed in wording: it names `divergence.ts` and the `omittedModules` inside
  it. `ReducedDeploymentError` keeps its name — all three of its findings are
  about a module set that is genuinely reduced.
