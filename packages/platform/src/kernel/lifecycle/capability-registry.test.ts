import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import {
  capabilityRegistryFrom,
  ContestedCapabilityError,
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

  it('refuses nothing over an empty manifest list', () => {
    const registry = capabilityRegistryFrom([]);
    expect(registry.declarations).toEqual([]);
    expect(registry.exclusive).toEqual([]);
  });
});
