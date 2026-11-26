/**
 * #1941 case 3 — the owner map of `column-extension` comes from
 * `CUSTOM_FIELD_HOST_BINDINGS`. A contracts build without that registry used to
 * read as an empty map, which turned every declaration into `unowned-subject`:
 * a finding that blames the deployment for a broken toolchain. It must refuse.
 *
 * The mock is file-wide, which is why this proof has a file of its own.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@endora-commerce/contracts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  CUSTOM_FIELD_HOST_BINDINGS: undefined,
}));

const { deriveDivergence, extensibleHostOwners } = await import('../src/lib/divergence.js');

const BACKEND = `
import { defineColumnExtension } from '@endora-commerce/platform/kernel';
export const schemaExtensions = [
  defineColumnExtension({ host: 'organizations', module: 'acme_erp', columns: { erpCode: { type: 'text' } } }),
];
`;

describe('extensibleHostOwners without CUSTOM_FIELD_HOST_BINDINGS (#1941)', () => {
  it('throws instead of returning an empty owner map', () => {
    expect(() => extensibleHostOwners()).toThrow(/CUSTOM_FIELD_HOST_BINDINGS/);
  });

  it('fails the derivation rather than reporting the declaration as unowned-subject', () => {
    expect(() =>
      deriveDivergence({
        deployment: 'acme',
        overlayRoot: 'backend/src/apps/acme/modules',
        overlayModules: ['acme_erp'],
        sources: [{ moduleId: 'acme_erp', file: 'backend/src/apps/acme/modules/acme_erp/backend.ts', text: BACKEND }],
        routes: new Map(),
        owners: new Map(),
        rootSupplied: new Set(),
        declaration: { omittedModules: [], decorationOrder: {}, reasons: {} },
        seams: [],
      }),
    ).toThrow(/CUSTOM_FIELD_HOST_BINDINGS/);
  });
});
