import { describe, expect, it } from 'vitest';
import type { ModuleManifest, RegistryState } from '@b2b/contracts';
import { EventBus } from '../../../src/events/bus.js';
import { createRootContainer } from '../../../src/kernel/container.js';
import { composeModules } from '../../../src/kernel/compose.js';
import {
  absentRequiredModules,
  assertRequiredModulesPresent,
  requiredModulesFrom,
  RequiredModuleAbsentError,
  type RequiredModule,
  type RequiredModulePresence,
} from '../../../src/kernel/lifecycle/required-modules.js';

/**
 * A composition may not reach its boot phase without a module it requires
 * (issue #258).
 *
 * The fixtures enter at the top of the analysis: manifests for the derivation,
 * and a presence object for the verdict. Nothing here is a value a composition
 * already computed, which is the property that lets these cases catch a defect
 * in the classification rather than only in the plumbing above it.
 */

function manifest(
  id: string,
  activation: ModuleManifest['activation'],
): ModuleManifest {
  return { id, version: '1.0.0', activation } as unknown as ModuleManifest;
}

/** Presence, as data: what is installed, and what is switched off. */
function presenceOf(
  states: Readonly<Record<string, RegistryState | 'not-installed'>>,
): RequiredModulePresence {
  return {
    isPresent: (moduleId) => states[moduleId] === 'installed',
    presence: (moduleId) => {
      const platformState = states[moduleId];
      return platformState === undefined ? undefined : { platformState };
    },
  };
}

const SETTINGS_REASON =
  'The configuration surface for every other module. A module that is off has no editable ' +
  'configuration, so switching this off would leave nothing on the platform configurable.';

describe('the required set is derived from the manifests', () => {
  it('is exactly the modules declaring `activation.nonDeactivatable`', () => {
    const required = requiredModulesFrom([
      manifest('settings', { nonDeactivatable: true, reason: SETTINGS_REASON }),
      manifest('blog', { settingCode: 'blog.enabled', default: true }),
      manifest('health_checks', undefined),
    ]);

    expect(required.map((entry) => entry.moduleId)).toEqual(['settings']);
  });

  it('carries the module’s own reason, so the refusal prints the sentence its author wrote', () => {
    const required = requiredModulesFrom([
      manifest('settings', { nonDeactivatable: true, reason: SETTINGS_REASON }),
    ]);

    expect(required[0]?.reason).toBe(SETTINGS_REASON);
  });

  /**
   * The derivation is the whole guard against D-100's failure mode: withdraw a
   * lock and the requirement goes with it, in the same run, with no list to
   * edit and nothing left asserting the opposite.
   */
  it('drops a module the same run its manifest stops declaring the lock', () => {
    expect(
      requiredModulesFrom([manifest('taxes', { settingCode: 'taxes.enabled', default: true })]),
    ).toEqual([]);
  });
});

describe('a required module that is absent', () => {
  const required: readonly RequiredModule[] = [
    { moduleId: 'settings', reason: SETTINGS_REASON },
  ];

  it('is not a finding when it is composed and present', () => {
    expect(
      absentRequiredModules(required, new Set(['settings']), presenceOf({ settings: 'installed' })),
    ).toEqual([]);
  });

  it('is `absent` when it was composed and presence says otherwise', () => {
    const findings = absentRequiredModules(
      required,
      new Set(['settings']),
      presenceOf({ settings: 'disabled' }),
    );

    expect(findings).toEqual([
      {
        kind: 'absent',
        moduleId: 'settings',
        reason: SETTINGS_REASON,
        platformState: 'disabled',
      },
    ]);
  });

  /**
   * The mis-built artefact, and the one absence `loadModulePresence` cannot see:
   * it runs before the first module registers, so a manifest index and a
   * composed module list that disagree both look correct to it.
   */
  it('is `not-composed` when the manifests declare it and no module registered it', () => {
    const findings = absentRequiredModules(
      required,
      new Set(['invoices']),
      presenceOf({ settings: 'installed', invoices: 'installed' }),
    );

    expect(findings).toEqual([
      { kind: 'not-composed', moduleId: 'settings', reason: SETTINGS_REASON },
    ]);
  });

  it('is `not-composed`, not `absent`, when it is neither composed nor present', () => {
    const findings = absentRequiredModules(required, new Set(), presenceOf({}));

    expect(findings.map((finding) => finding.kind)).toEqual(['not-composed']);
  });

  it('reports every one of them, so a reduced deployment is not fixed one boot at a time', () => {
    const findings = absentRequiredModules(
      [
        { moduleId: 'settings', reason: SETTINGS_REASON },
        { moduleId: 'orders', reason: 'The transacting core.' },
      ],
      new Set(['settings', 'orders']),
      presenceOf({ settings: 'disabled', orders: 'uninstalled' }),
    );

    expect(findings.map((finding) => finding.moduleId)).toEqual(['settings', 'orders']);
  });
});

describe('the sentence a mis-built deployment reads', () => {
  function refusal(
    composed: ReadonlySet<string>,
    states: Readonly<Record<string, RegistryState | 'not-installed'>>,
  ): RequiredModuleAbsentError {
    try {
      assertRequiredModulesPresent(
        [{ moduleId: 'settings', reason: SETTINGS_REASON }],
        composed,
        presenceOf(states),
      );
    } catch (err) {
      return err as RequiredModuleAbsentError;
    }
    throw new Error('expected a refusal');
  }

  it('names the module, its manifest’s reason and the operator’s remedy', () => {
    const error = refusal(new Set(['settings']), { settings: 'disabled' });

    expect(error).toBeInstanceOf(RequiredModuleAbsentError);
    expect(error.message).toContain('settings');
    expect(error.message).toContain(SETTINGS_REASON);
    expect(error.message).toContain('module:enable settings');
  });

  it('sends a mis-built artefact to the generator instead of to `module:enable`', () => {
    const error = refusal(new Set(), { settings: 'installed' });

    expect(error.message).toContain('composer:generate');
    expect(error.message).not.toContain('module:enable');
  });

  /**
   * D-101's closing rule: three refusals rest on one manifest declaration and
   * they share nothing else. A reader must be able to tell which question they
   * are looking at without reading the other two, so this one keeps its own
   * type and its own name.
   */
  it('is its own error type, not a deactivation refusal wearing a new message', () => {
    const error = refusal(new Set(['settings']), { settings: 'not-installed' });

    expect(error.name).toBe('RequiredModuleAbsentError');
    expect(error.findings).toHaveLength(1);
  });
});

describe('the composer applies it before anything registers', () => {
  function compose(requiredModules: readonly RequiredModule[], registered: string[]): void {
    composeModules(
      [
        {
          id: 'invoices',
          version: '1.0.0',
          registerModule: () => {
            registered.push('invoices');
          },
        },
      ],
      {
        container: createRootContainer(),
        eventBus: new EventBus(),
        log: { info: () => {}, warn: () => {}, error: () => {} },
        requiredModules,
      },
    );
  }

  /**
   * `not-composed` is decided from the entries alone, so this case needs no
   * presence at all — which is the point: the refusal lands before the composer
   * has run a single `registerModule`, and therefore long before the boot phase
   * where the failure it prevents used to surface.
   */
  it('registers nothing at all when a required module is missing', () => {
    const registered: string[] = [];

    expect(() => compose([{ moduleId: 'settings', reason: SETTINGS_REASON }], registered)).toThrow(
      RequiredModuleAbsentError,
    );
    expect(registered).toEqual([]);
  });

  /**
   * A composition that requires nothing is left alone. Without that, every
   * fixture composing two modules that do not exist would be judged against a
   * process-wide presence singleton it has nothing to do with.
   */
  it('leaves a composition that requires nothing alone', () => {
    const registered: string[] = [];

    compose([], registered);

    expect(registered).toEqual(['invoices']);
  });
});
