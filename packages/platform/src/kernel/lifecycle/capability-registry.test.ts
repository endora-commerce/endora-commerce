import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import {
  capabilityRegistryFrom,
  ContestedCapabilityError,
  DefaultActivatedMemberError,
  type CapabilityRegistry,
} from './capability-registry.js';

/**
 * The derived capability registry — feature 132,
 * `specs/132-connector-family-discovery/contracts/module-capabilities.md` R3,
 * `data-model.md` §2.
 *
 * The fixtures are manifests, because that is the top of the analysis and the
 * only input the derivation has: **the platform may not import a module**
 * (D-52/D-53), so a family arrives as a parameter and never as a specifier. The
 * shape follows `activationDeclarationsFrom` and `requiredModulesFrom` for the
 * reason their own headers give — a hand-written copy of a derived fact goes
 * stale silently (D-100), so there is no list to edit when a member joins.
 */
function manifest(overrides: Partial<ModuleManifest> & { id: string }): ModuleManifest {
  return { version: '1.0.0', dependencies: [], ...overrides } as unknown as ModuleManifest;
}

const member = (id: string, ...capabilities: string[]): ModuleManifest =>
  manifest({
    id,
    capabilities,
    activation: { settingCode: `${id}.activation`, default: false },
  });

const owner = (id: string, key: string, errorCode: string): ModuleManifest =>
  manifest({
    id,
    activation: { nonDeactivatable: true, reason: 'The family owner is always present.' },
    exclusiveCapabilities: [{ key, errorCode }],
  });

describe('capabilityRegistryFrom', () => {
  it('distils one declaration per declaring module, and omits the silent ones', () => {
    const registry: CapabilityRegistry = capabilityRegistryFrom([
      member('pim_akeneo', 'pim-connector'),
      manifest({ id: 'catalog' }),
      member('comarch_xl', 'erp-connector'),
    ]);

    expect(registry.declarations).toEqual([
      { moduleId: 'pim_akeneo', capabilities: ['pim-connector'] },
      { moduleId: 'comarch_xl', capabilities: ['erp-connector'] },
    ]);
    expect(registry.exclusive).toEqual([]);
  });

  it('omits a module whose `capabilities` is present but empty — it declares nothing', () => {
    const registry = capabilityRegistryFrom([
      manifest({
        id: 'fixture_empty',
        capabilities: [],
        activation: { settingCode: 'fixture_empty.activation', default: false },
      }),
    ]);
    expect(registry.declarations).toEqual([]);
  });

  it('carries a member declaring two keys — a module may belong to two families', () => {
    const registry = capabilityRegistryFrom([
      member('fixture_pair', 'pim-connector', 'erp-connector'),
    ]);
    expect(registry.declarations).toEqual([
      { moduleId: 'fixture_pair', capabilities: ['pim-connector', 'erp-connector'] },
    ]);
  });

  it('records the owner and the code it minted for each exclusive key', () => {
    const registry = capabilityRegistryFrom([
      owner('pim_connector', 'pim-connector', 'PIM_CONNECTOR_ALREADY_ACTIVE'),
      owner('erp_connector', 'erp-connector', 'ERP_CONNECTOR_ALREADY_ACTIVE'),
      member('pim_unopim', 'pim-connector'),
    ]);

    expect(registry.exclusive).toEqual([
      {
        key: 'pim-connector',
        ownerModuleId: 'pim_connector',
        errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE',
      },
      {
        key: 'erp-connector',
        ownerModuleId: 'erp_connector',
        errorCode: 'ERP_CONNECTOR_ALREADY_ACTIVE',
      },
    ]);
  });

  it('is plain data — nothing in it is a manifest, so the hot path never holds the graph', () => {
    const registry = capabilityRegistryFrom([
      owner('pim_connector', 'pim-connector', 'PIM_CONNECTOR_ALREADY_ACTIVE'),
      member('pim_unopim', 'pim-connector'),
    ]);
    expect(JSON.parse(JSON.stringify(registry))).toEqual(registry);
  });

  describe('R3.4 — two owners of one key is a refusal at derivation', () => {
    it('refuses, naming both claimants and the key', () => {
      let message = '';
      let thrown: unknown;
      try {
        capabilityRegistryFrom([
          owner('pim_connector', 'pim-connector', 'PIM_CONNECTOR_ALREADY_ACTIVE'),
          owner('pim_connector_fork', 'pim-connector', 'PIM_FORK_ALREADY_ACTIVE'),
        ]);
      } catch (err) {
        thrown = err;
        message = (err as Error).message;
      }

      expect(thrown).toBeInstanceOf(ContestedCapabilityError);
      expect(message).toContain('pim-connector');
      expect(message).toContain('pim_connector');
      expect(message).toContain('pim_connector_fork');
    });

    it('carries both claimants as data, so a caller need not parse the sentence', () => {
      try {
        capabilityRegistryFrom([
          owner('a_owner', 'pim-connector', 'A_ALREADY_ACTIVE'),
          owner('b_owner', 'pim-connector', 'B_ALREADY_ACTIVE'),
        ]);
        expect.unreachable('two owners of one key must be refused');
      } catch (err) {
        expect(err).toBeInstanceOf(ContestedCapabilityError);
        expect((err as ContestedCapabilityError).findings).toEqual([
          { key: 'pim-connector', ownerModuleIds: ['a_owner', 'b_owner'] },
        ]);
      }
    });

    it('does not refuse two owners of two DIFFERENT keys', () => {
      expect(() =>
        capabilityRegistryFrom([
          owner('pim_connector', 'pim-connector', 'PIM_CONNECTOR_ALREADY_ACTIVE'),
          owner('erp_connector', 'erp-connector', 'ERP_CONNECTOR_ALREADY_ACTIVE'),
        ]),
      ).not.toThrow();
    });
  });

  describe('R3.5 — a key no installed module owns is NOT a refusal', () => {
    it('derives the family and leaves the key non-exclusive', () => {
      // A deployment that installed two connectors and not their shared layer.
      // Refusing would turn a shared layer into an undeclared hard dependency,
      // which is what `dependencies` is for and which the member already declares
      // if it genuinely needs it.
      const registry = capabilityRegistryFrom([
        member('pim_unopim', 'pim-connector'),
        member('pim_akeneo', 'pim-connector'),
      ]);

      expect(registry.declarations.map((d) => d.moduleId)).toEqual([
        'pim_unopim',
        'pim_akeneo',
      ]);
      expect(registry.exclusive).toEqual([]);
    });
  });

  describe('R3.6 / FR-016 — a member of an EXCLUSIVE key may not default to activated', () => {
    // ## Why the refusal is here and not in the runtime test
    //
    // `resolveActivation` returns `Map<string, boolean>` and carries **no
    // provenance**: nothing downstream can tell "the operator wrote this row" from
    // "no row exists and the manifest said `true`". So a mutual exclusion resolved on
    // the activation axis cannot ask the question it needs to ask, and a
    // default-activated member holds a claim nobody made.
    //
    // The tempting repair — add provenance and have the exclusion require an
    // **explicit** choice — is unsafe, and `research.md` D6 records why: member A
    // default-activated and member B explicitly activated would then **both** be
    // active, because the test that was supposed to refuse B now ignores A. A mutual
    // exclusion may not fail open. Refusing the manifest instead makes the state
    // unreachable rather than tolerated, which is the difference between a guard and a
    // repair.
    //
    // It is also not in `defineModuleManifest`, for the reason R3.4 is not: that
    // function sees one manifest and cannot see whether the key is exclusive, which is
    // the **owner's** declaration. Both facts are in hand only here.

    const exclusiveOwner = owner('pim_connector', 'pim-connector', 'PIM_CONNECTOR_ALREADY_ACTIVE');

    const defaultOn = (id: string, ...capabilities: string[]): ModuleManifest =>
      manifest({
        id,
        capabilities,
        activation: { settingCode: `${id}.activation`, default: true },
      });

    it('refuses, naming the module and the key', () => {
      let message = '';
      let thrown: unknown;
      try {
        capabilityRegistryFrom([exclusiveOwner, defaultOn('pim_akeneo', 'pim-connector')]);
      } catch (err) {
        thrown = err;
        message = (err as Error).message;
      }

      expect(thrown).toBeInstanceOf(DefaultActivatedMemberError);
      expect(message).toContain('pim_akeneo');
      expect(message).toContain('pim-connector');
      expect(message).toContain('pim_akeneo.activation');
    });

    it('carries every offender as data, so a caller need not parse the sentence', () => {
      try {
        capabilityRegistryFrom([
          exclusiveOwner,
          defaultOn('pim_akeneo', 'pim-connector'),
          member('pim_unopim', 'pim-connector'),
          defaultOn('pim_pimcore', 'pim-connector'),
        ]);
        expect.unreachable('a default-activated member of an exclusive key must be refused');
      } catch (err) {
        expect(err).toBeInstanceOf(DefaultActivatedMemberError);
        expect((err as DefaultActivatedMemberError).findings).toEqual([
          { moduleId: 'pim_akeneo', key: 'pim-connector', settingCode: 'pim_akeneo.activation' },
          { moduleId: 'pim_pimcore', key: 'pim-connector', settingCode: 'pim_pimcore.activation' },
        ]);
      }
    });

    it('does NOT refuse a default-activated member of a key nobody owns (R3.5)', () => {
      // The key is not exclusive in that deployment, so there is no claim to hold and
      // nothing for a default to pre-empt. Refusing here would make a shared layer an
      // undeclared hard dependency — the same reason R3.5 tolerates the member at all.
      expect(() =>
        capabilityRegistryFrom([defaultOn('some_vendor_pim', 'pim-connector')]),
      ).not.toThrow();
    });

    it('does NOT refuse the OWNER for defaulting on, and the owners in this tree are locked', () => {
      // An owner is not resolved on the activation axis — its members are — and all
      // three owners in this tree declare `activation.nonDeactivatable`, which resolves
      // to `true` by construction. Refusing that would refuse every deployment.
      expect(() =>
        capabilityRegistryFrom([
          exclusiveOwner,
          member('pim_unopim', 'pim-connector'),
        ]),
      ).not.toThrow();
    });

    it('does NOT refuse a member that declares `default: false`', () => {
      expect(() =>
        capabilityRegistryFrom([exclusiveOwner, member('pim_unopim', 'pim-connector')]),
      ).not.toThrow();
    });

    it('refuses a member declaring TWO keys when only one of them is exclusive', () => {
      // The offender is reported per (module, key) pair, so the finding says which of
      // the module's keys is the one that cannot tolerate the default.
      try {
        capabilityRegistryFrom([
          exclusiveOwner,
          defaultOn('fixture_pair', 'pim-connector', 'some-open-key'),
        ]);
        expect.unreachable('must be refused for the exclusive key');
      } catch (err) {
        expect((err as DefaultActivatedMemberError).findings).toEqual([
          {
            moduleId: 'fixture_pair',
            key: 'pim-connector',
            settingCode: 'fixture_pair.activation',
          },
        ]);
      }
    });

    it('reports the two-owner refusal before this one — a contested key has no owner to judge by', () => {
      // Ordering matters: whether a member's default is illegal depends on the key
      // being exclusive, and a key with two claimants routes to neither. The
      // deployment is mis-assembled in a way that has to be read first.
      expect(() =>
        capabilityRegistryFrom([
          exclusiveOwner,
          owner('pim_connector_fork', 'pim-connector', 'FORK_ALREADY_ACTIVE'),
          defaultOn('pim_akeneo', 'pim-connector'),
        ]),
      ).toThrow(ContestedCapabilityError);
    });
  });

  it('refuses nothing over an empty manifest list', () => {
    const registry = capabilityRegistryFrom([]);
    expect(registry.declarations).toEqual([]);
    expect(registry.exclusive).toEqual([]);
  });
});
