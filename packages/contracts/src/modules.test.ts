import { describe, expect, it } from 'vitest';
import { CAPABILITY_KEYS } from './capabilities.js';
import { defineModuleManifest, type ModuleManifest } from './modules.js';

/**
 * `specs/132-connector-family-discovery/contracts/module-capabilities.md` R4 —
 * the four cross-field rules `defineModuleManifest` can decide from **one**
 * manifest, on the author's own machine, at import time, with no database.
 *
 * R3.4 ("exactly one owner per key") and R3.6 ("a member of an exclusive key may
 * not default to activated") are deliberately **not** here: both need to see a
 * family, and this function sees one manifest. They are the derivation's
 * refusals (`capabilityRegistryFrom`).
 *
 * Every proof hands `defineModuleManifest` a whole manifest — the top of the
 * analysis, which is where a red proof has to enter. And every one asserts the
 * refusal **names the module and the key**, not merely that it throws: the
 * author reading it has sixty-odd manifests and a message that names neither
 * sends them hunting.
 */
function manifest(overrides: Partial<ModuleManifest> & { id: string }): ModuleManifest {
  return defineModuleManifest({
    name: 'Fixture module',
    version: '1.0.0',
    dependencies: [],
    ...overrides,
  } as ModuleManifest);
}

/** The activation control must sit in the declaring module's own namespace, so it is derived. */
function activation(id: string): { settingCode: string; default: boolean } {
  return { settingCode: `${id}.activation`, default: false };
}

describe('defineModuleManifest — capability declarations (feature 132, contract R4)', () => {
  describe('what it accepts', () => {
    it('accepts a member: `capabilities` beside an activation control', () => {
      const parsed = manifest({
        id: 'fixture_capabilities',
        capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR],
        activation: activation('fixture_capabilities'),
      });
      expect(parsed.capabilities).toEqual(['pim-connector']);
    });

    it('accepts an owner: `exclusiveCapabilities` with the code it mints', () => {
      const parsed = manifest({
        id: 'fixture_owner',
        activation: { nonDeactivatable: true, reason: 'The family owner is always present.' },
        exclusiveCapabilities: [
          { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
        ],
      });
      expect(parsed.exclusiveCapabilities).toEqual([
        { key: 'pim-connector', errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
      ]);
    });

    it('accepts a manifest that declares neither — absent is most modules and is not a finding', () => {
      const parsed = manifest({ id: 'fixture_silent' });
      expect(parsed.capabilities).toBeUndefined();
      expect(parsed.exclusiveCapabilities).toBeUndefined();
    });

    it('accepts an owner declaring membership of a DIFFERENT key — two keys never exclude each other', () => {
      const parsed = manifest({
        id: 'fixture_both_keys',
        activation: activation('fixture_both_keys'),
        capabilities: [CAPABILITY_KEYS.ERP_CONNECTOR],
        exclusiveCapabilities: [
          { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
        ],
      });
      expect(parsed.capabilities).toEqual(['erp-connector']);
    });

    it('refuses a key that is not kebab-case — the schema shape, R1.2', () => {
      expect(() =>
        manifest({
          id: 'fixture_capabilities',
          activation: activation('fixture_capabilities'),
          capabilities: ['pim_connector'],
        }),
      ).toThrow();
    });
  });

  describe('R4.1 — a member MUST declare `activation`', () => {
    it('refuses, naming the module and the key it declared', () => {
      let message = '';
      try {
        manifest({
          id: 'fixture_no_activation',
          capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR],
        });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain('fixture_no_activation');
      expect(message).toContain('pim-connector');
      expect(message).toContain('activation');
    });

    it('does not ask it of an OWNER that declares no membership', () => {
      // An owner needs no activation control for this rule's sake: it is not
      // resolved on the activation axis, its members are. (In this tree all
      // three owners are `nonDeactivatable`, which is a separate decision.)
      expect(() =>
        manifest({
          id: 'fixture_owner_no_activation',
          exclusiveCapabilities: [
            { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
          ],
        }),
      ).not.toThrow();
    });
  });

  describe('R4.2 — `capabilities` MUST NOT contain a duplicate key', () => {
    it('refuses, naming the module and the key', () => {
      let message = '';
      try {
        manifest({
          id: 'fixture_dup_member',
          activation: activation('fixture_dup_member'),
          capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR, CAPABILITY_KEYS.PIM_CONNECTOR],
        });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain('fixture_dup_member');
      expect(message).toContain('pim-connector');
    });
  });

  describe('R4.3 — `exclusiveCapabilities` MUST NOT carry two entries for one key', () => {
    it('refuses, naming the module and the key', () => {
      let message = '';
      try {
        manifest({
          id: 'fixture_dup_owner',
          activation: activation('fixture_dup_owner'),
          exclusiveCapabilities: [
            { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
            { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'ERP_CONNECTOR_ALREADY_ACTIVE' },
          ],
        });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain('fixture_dup_owner');
      expect(message).toContain('pim-connector');
    });
  });

  describe('R4.4 — one key MUST NOT appear in both arrays of one manifest (R3.3)', () => {
    it('refuses, naming the module and the key', () => {
      let message = '';
      try {
        manifest({
          id: 'fixture_self_family',
          activation: activation('fixture_self_family'),
          capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR],
          exclusiveCapabilities: [
            { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
          ],
        });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain('fixture_self_family');
      expect(message).toContain('pim-connector');
    });
  });
});
