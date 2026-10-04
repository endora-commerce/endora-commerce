---
"@endora-commerce/contracts": minor
---

A module's `./admin` layer may contribute editor renderers for its own Page Builder blocks: `AdminContributions` gains an optional `blocks` array of `AdminBlockContribution` (`{ name, context: 'cms' | 'email', component }`), with `AdminBlockContributionSchema` for the data half. New `EmailBlockRendererRegistryPort<R>` and `EmailBlockRendererRegistrationResult` describe the container name `emailBlockRendererRegistry`, which `email` owns and a module registers its e-mail block renderers into from `ctx.onBoot`. Additive: a contribution set without `blocks` is unchanged.
