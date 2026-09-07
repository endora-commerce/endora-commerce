import type { DeploymentDivergenceDeclaration } from '@endora-commerce/contracts';

/**
 * How `acceptance` means to differ from core: in exactly one way, deliberately.
 *
 * `apps/example/divergence.ts` carries the full note on what each of the three
 * fields is for. The omissions are **two-way** — an entry for a module this
 * deployment does ship fails the boot exactly as loudly as an undeclared
 * omission — and the `reasons` map is two-way against the *derived* report:
 * a divergence with no sentence and a sentence with no divergence both fail
 * `check:divergence`.
 */
export const divergence: DeploymentDivergenceDeclaration = {
  omittedModules: [],
  decorationOrder: {},
  reasons: {
    'decoration:acceptance_overlay:acceptanceProbeGreeter':
      'Core hands every consumer the greeter that `@endora-commerce/mod-acceptance-probe` — an ' +
      'installed extension package — registers. This deployment wraps it, delegating, so that ' +
      'the acceptance criterion can measure what the platform does when an overlay module ' +
      'reaches for a registration an installed package owns. The answer is ' +
      '`PackageDecorationNotOfferedError` (D-176 Q3): the wrap is expected to be refused, and ' +
      'the refusal is what A10 asserts. It stays because deleting it would delete the reach ' +
      'that makes the refusal measurable.',
  },
};
