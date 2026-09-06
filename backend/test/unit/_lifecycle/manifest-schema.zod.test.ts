import { describe, it, expect } from 'vitest';
import {
  ModuleManifestSchema,
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

describe('ModuleManifestSchema', () => {
  it('accepts a minimal valid manifest', () => {
    const parsed = ModuleManifestSchema.parse({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      dependencies: [],
    });
    expect(parsed.id).toBe('demo');
    expect(parsed.dependencies).toEqual([]);
  });

  it('rejects a non-conforming id (uppercase)', () => {
    expect(() =>
      ModuleManifestSchema.parse({
        id: 'Demo',
        name: 'Demo',
        version: '1.0.0',
        dependencies: [],
      }),
    ).toThrow();
  });

  it('rejects a non-conforming version', () => {
    expect(() =>
      ModuleManifestSchema.parse({
        id: 'demo',
        name: 'Demo',
        version: '1.0',
        dependencies: [],
      }),
    ).toThrow();
  });

  it('accepts the underscore-prefixed reserved id', () => {
    const parsed = ModuleManifestSchema.parse({
      id: '_lifecycle',
      name: 'Lifecycle',
      version: '1.0.0',
      dependencies: [],
    });
    expect(parsed.id).toBe('_lifecycle');
  });
});

describe('defineModuleManifest', () => {
  it('rejects a self-dependency', () => {
    expect(() =>
      defineModuleManifest({
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        dependencies: ['demo'],
      }),
    ).toThrow(/depends on itself/);
  });

  it('rejects a settings.moduleCode mismatch', () => {
    expect(() =>
      defineModuleManifest({
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        dependencies: [],
        settings: defineModuleSettingsManifest({
          moduleCode: 'other',
          groups: [],
          settings: [],
        }),
      }),
    ).toThrow(/moduleCode/);
  });

  it('round-trips a manifest with settings', () => {
    const m = defineModuleManifest({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      dependencies: [],
      settings: defineModuleSettingsManifest({
        moduleCode: 'demo',
        groups: [{ code: 'demo', name: 'Demo' }],
        settings: [],
      }),
    });
    expect(m.settings?.moduleCode).toBe('demo');
    expect(m.settings?.groups[0]?.code).toBe('demo');
  });

  it('carries no licence tier — D-194 removed the edition meta-packages it existed for', () => {
    // The field was `license: 'core' | 'pro' | 'enterprise'`, validated and
    // audited and read by nothing: no gate consulted it, no admin screen
    // rendered it, and the tier meta-packages it was reserved for do not exist.
    // A Zod object is non-strict, so a manifest that still declares one is not
    // refused — the key is dropped. This asserts the drop rather than a refusal,
    // because the drop is what a client on an older manifest actually gets.
    const declared = {
      id: 'paid_module',
      name: 'Paid',
      version: '1.0.0',
      dependencies: [],
      license: 'pro',
    };
    const m = defineModuleManifest(declared as unknown as Parameters<typeof defineModuleManifest>[0]);
    expect(m).not.toHaveProperty('license');
  });
});

/**
 * `nonBindingDependencies` — D-44.
 *
 * The three cross-field rules, each driven red on a synthetic manifest before
 * the rule existed. They live in `defineModuleManifest` rather than in the
 * schema for the same reason the activation rules do: the message has to name
 * the module the author is looking at, and a Zod refinement over an optional
 * array cannot see `dependencies` and `acknowledgedDependencies` beside it.
 */
describe('defineModuleManifest — nonBindingDependencies', () => {
  const edge = {
    moduleId: 'prompt_actions',
    name: 'promptActionToolRegistry',
    kind: 'contributes-to' as const,
    reason: 'Pushes an inert tool descriptor into the assistant catalogue at boot.',
  };

  it('accepts a contributes-to edge with no whenAbsent', () => {
    const m = defineModuleManifest({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      dependencies: [],
      nonBindingDependencies: [edge],
    });
    expect(m.nonBindingDependencies?.[0]?.kind).toBe('contributes-to');
  });

  it('accepts a degrades-without edge that states what stops working', () => {
    const m = defineModuleManifest({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      dependencies: [],
      nonBindingDependencies: [
        {
          moduleId: 'orders',
          name: 'orderListServiceAccessor',
          kind: 'degrades-without',
          whenAbsent: 'self-service order history is empty',
          reason: 'The history panel answers an empty page rather than failing the request.',
        },
      ],
    });
    expect(m.nonBindingDependencies?.[0]?.whenAbsent).toBe(
      'self-service order history is empty',
    );
  });

  it('rejects an edge that names the declaring module itself', () => {
    expect(() =>
      defineModuleManifest({
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        dependencies: [],
        nonBindingDependencies: [{ ...edge, moduleId: 'demo' }],
      }),
    ).toThrow(/itself/);
  });

  it('rejects an edge whose target is already in `dependencies`', () => {
    // One edge, one claim, in one place. Both present means the ordinary
    // declaration already carries the bind and the install order, and the
    // withdrawal beside it is a second record of the same edge that nothing
    // keeps in step.
    expect(() =>
      defineModuleManifest({
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        dependencies: ['prompt_actions'],
        nonBindingDependencies: [edge],
      }),
    ).toThrow(/already declares/);
  });

  it('rejects an edge whose target is already acknowledged', () => {
    expect(() =>
      defineModuleManifest({
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        dependencies: [],
        acknowledgedDependencies: [
          {
            moduleId: 'prompt_actions',
            port: 'promptActionToolRegistry',
            reason: 'A cycle spelled out at length so the length floor is met here too.',
          },
        ],
        nonBindingDependencies: [edge],
      }),
    ).toThrow(/already acknowledges/);
  });

  it('rejects a degrades-without edge with no whenAbsent', () => {
    // The kind is a promise about behaviour. Without the sentence there is
    // nothing to review, nothing for the platform screen to render, and nothing
    // an off-state test can be held to.
    expect(() =>
      defineModuleManifest({
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        dependencies: [],
        nonBindingDependencies: [
          {
            moduleId: 'orders',
            name: 'orderListServiceAccessor',
            kind: 'degrades-without',
            reason: 'The history panel tolerates an unbound service.',
          },
        ],
      }),
    ).toThrow(/whenAbsent/);
  });

  it('accepts a refuses-without edge that names what refuses', () => {
    const m = defineModuleManifest({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      dependencies: [],
      nonBindingDependencies: [
        {
          moduleId: 'payments',
          name: 'orderPlacementPaymentApplyPort',
          kind: 'refuses-without',
          whenAbsent: 'checkout cannot take an order, because no payment method is available',
          reason:
            'The placement seam has no fallback and lets the 503 reach the buyer; binding ' +
            'would make the owner a module nobody can switch off.',
        },
      ],
    });
    expect(m.nonBindingDependencies?.[0]?.kind).toBe('refuses-without');
  });

  it('rejects a refuses-without edge with no whenAbsent', () => {
    // The outcome such an edge produces is the one an undeclared gated port
    // produces anyway, so without the sentence the declaration is inert — and
    // an inert declaration is worse than none, because it reads as an answer.
    expect(() =>
      defineModuleManifest({
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        dependencies: [],
        nonBindingDependencies: [
          {
            moduleId: 'payments',
            name: 'orderPlacementPaymentApplyPort',
            kind: 'refuses-without',
            reason: 'The placement seam has no fallback.',
          },
        ],
      }),
    ).toThrow(/whenAbsent/);
  });

  it('rejects a refuses-without edge whose owner the same manifest binds', () => {
    // This is the guard that keeps the kind honest, and it is rule 2 rather
    // than a rule of its own: `dependencies` is what `ModuleGatingGraph`
    // builds the flip-time refusal from, so an entry claiming "the owner's
    // control keeps working" beside one is a manifest saying both things at
    // once. It is refused for every kind and has been since D-44; the value
    // here is that the new kind's whole point rests on it.
    expect(() =>
      defineModuleManifest({
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        dependencies: ['payments'],
        nonBindingDependencies: [
          {
            moduleId: 'payments',
            name: 'orderPlacementPaymentApplyPort',
            kind: 'refuses-without',
            whenAbsent: 'checkout cannot take an order',
            reason: 'The placement seam has no fallback.',
          },
        ],
      }),
    ).toThrow(/already declares/);
  });

  it('rejects a contributes-to edge that carries a whenAbsent', () => {
    // Nothing degrades when a push lands in a table nobody enumerates, so a
    // sentence saying otherwise is a claim the code does not make.
    expect(() =>
      defineModuleManifest({
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        dependencies: [],
        nonBindingDependencies: [{ ...edge, whenAbsent: 'the assistant loses a tool' }],
      }),
    ).toThrow(/whenAbsent/);
  });
});
