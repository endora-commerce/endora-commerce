---
"@endora-commerce/admin-kit": minor
---

`AdminContributionsProvider` also carries the `blocks` each module contributes, and `@endora-commerce/admin-kit/zones` exports `useBlockContributions(context)` — the editor renderers the present modules contribute for `cms` or `email`, with no factory evaluated — together with `selectBlockContributions`, `OwnedBlockContribution` and `BlockContributionContext`. A block a module contributes under a name another module owns is dropped.
