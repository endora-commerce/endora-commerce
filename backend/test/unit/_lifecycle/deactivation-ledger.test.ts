import { describe, expect, it } from 'vitest';

import {
  buildDeactivationLedger,
  deactivationConsequencesFor,
  type LedgerInput,
  type CrossModuleRead,
} from '../../../src/modules/_lifecycle/services/deactivation-ledger.js';

/**
 * The deactivation-consequence ledger (feature 074, FR-017 … FR-023).
 *
 * Two properties are pinned here and they are the same artefact seen from the
 * two ends it exists to join:
 *
 *  1. **The build question.** Every cross-module edge whose owner an operator
 *     may switch off gets one of four outcomes, and an edge that gets none is
 *     reported by shape rather than skipped. `check-port-dependencies.ts` fails
 *     the build on the second list.
 *  2. **The operator question.** The rows the confirmation dialog renders — and
 *     the rows the 409 `MODULE_DEACTIVATION_UNCONFIRMED` envelope carries — are
 *     {@link deactivationConsequencesFor} over the same entries. One function,
 *     so the two id sets cannot drift apart; FR-022 asks for exactly that and
 *     for it to be structural rather than kept in step by hand.
 */

const read = (over: Partial<CrossModuleRead> & Pick<CrossModuleRead, 'moduleId' | 'dependsOn' | 'name'>): CrossModuleRead => ({
  gated: false,
  captured: false,
  site: 'call',
  ...over,
});

const input = (over: Partial<LedgerInput>): LedgerInput => ({
  reads: [],
  declaredDependencies: new Map(),
  nonBinding: [],
  neverAbsentOwners: new Set(),
  contributionPolicies: {},
  excludedNames: new Set(),
  ...over,
});

describe('the four acceptable outcomes', () => {
  it('O1 — a call-time read of a gated port fails closed at the seam', () => {
    const ledger = buildDeactivationLedger(
      input({ reads: [read({ moduleId: 'shipments', dependsOn: 'invoices', name: 'invoiceService', gated: true })] }),
    );

    expect(ledger.unassigned).toEqual([]);
    expect(ledger.entries).toEqual([
      {
        moduleId: 'shipments',
        dependsOn: 'invoices',
        name: 'invoiceService',
        outcome: 'fails-closed',
        whenAbsent: null,
      },
    ]);
  });

  it('O2 — a `degrades-without` declaration carries its own sentence', () => {
    const ledger = buildDeactivationLedger(
      input({
        reads: [read({ moduleId: 'customers', dependsOn: 'orders', name: 'orderListServiceAccessor', gated: true })],
        nonBinding: [
          {
            moduleId: 'customers',
            dependsOn: 'orders',
            name: 'orderListServiceAccessor',
            kind: 'degrades-without',
            whenAbsent: 'self-service order history is empty',
            reason: 'the accessor answers null and the call site probes presence',
          },
        ],
      }),
    );

    expect(ledger.unassigned).toEqual([]);
    expect(ledger.entries[0]).toMatchObject({
      outcome: 'degrades',
      whenAbsent: 'self-service order history is empty',
    });
  });

  it('O3 — a boot push into a registry whose host states a policy costs nothing', () => {
    const ledger = buildDeactivationLedger(
      input({
        reads: [read({ moduleId: 'catalog', dependsOn: 'prompt_actions', name: 'promptActionToolRegistry', site: 'boot' })],
        contributionPolicies: { 'prompt_actions:promptActionToolRegistry': 'skip' },
      }),
    );

    expect(ledger.unassigned).toEqual([]);
    expect(ledger.entries[0]?.outcome).toBe('contributes');
  });

  it('O4 — a declared dependency with no container edge under it is schema-only', () => {
    const ledger = buildDeactivationLedger(
      input({ declaredDependencies: new Map([['shipments', ['invoices']]]) }),
    );

    expect(ledger.unassigned).toEqual([]);
    expect(ledger.entries).toEqual([
      { moduleId: 'shipments', dependsOn: 'invoices', name: null, outcome: 'schema-only', whenAbsent: null },
    ]);
  });

  it('reads a skip policy on a call-time read as the seam failing closed, not as a contribution', () => {
    // The host drops the entry whose owner is gone, so the caller gets nothing
    // back — which is the same answer a closed gate gives, arriving at
    // enumeration instead of at the port.
    const ledger = buildDeactivationLedger(
      input({
        reads: [read({ moduleId: 'shipments', dependsOn: 'delivery_methods', name: 'shippingAdapterRegistry' })],
        contributionPolicies: { 'delivery_methods:shippingAdapterRegistry': 'skip' },
      }),
    );

    expect(ledger.entries[0]?.outcome).toBe('fails-closed');
  });

  it('reads an honour policy as nothing happening, whoever asks', () => {
    const ledger = buildDeactivationLedger(
      input({
        reads: [read({ moduleId: 'blog', dependsOn: 'assets_library', name: 'assetReferenceRegistry' })],
        contributionPolicies: { 'assets_library:assetReferenceRegistry': 'honour' },
      }),
    );

    expect(ledger.entries[0]?.outcome).toBe('contributes');
  });
});

describe('the one unacceptable outcome, by shape', () => {
  it('refuses a captured cross-module registration', () => {
    const ledger = buildDeactivationLedger(
      input({
        reads: [read({ moduleId: 'orders', dependsOn: 'payment_methods', name: 'paymentAdapterRegistry', captured: true })],
        contributionPolicies: { 'payment_methods:paymentAdapterRegistry': 'skip' },
      }),
    );

    expect(ledger.entries).toEqual([]);
    expect(ledger.unassigned).toEqual([
      {
        moduleId: 'orders',
        dependsOn: 'payment_methods',
        name: 'paymentAdapterRegistry',
        shape: 'captured-registration',
        detail: 'read once at construction, so it keeps answering after `payment_methods` is switched off',
      },
    ]);
  });

  it('refuses a read of an ungated registry whose host states no policy', () => {
    const ledger = buildDeactivationLedger(
      input({ reads: [read({ moduleId: 'stripe', dependsOn: 'payments', name: 'gatewayRefundRegistry', site: 'boot' })] }),
    );

    expect(ledger.entries).toEqual([]);
    expect(ledger.unassigned[0]).toMatchObject({
      name: 'gatewayRefundRegistry',
      shape: 'registry-without-policy',
    });
  });

  it('refuses a gated port resolved before the platform serves its first request', () => {
    const ledger = buildDeactivationLedger(
      input({ reads: [read({ moduleId: 'megamenu', dependsOn: 'cms', name: 'cmsPageService', gated: true, site: 'boot' })] }),
    );

    expect(ledger.unassigned[0]).toMatchObject({ shape: 'gated-port-before-first-request' });
  });

  it('reports a captured registration even where a policy would otherwise clear the edge', () => {
    // Capture is about *when* the name is read, so it survives every other
    // answer the edge might have had. It is reported first for that reason.
    const ledger = buildDeactivationLedger(
      input({
        reads: [
          read({ moduleId: 'orders', dependsOn: 'delivery_methods', name: 'shippingAdapterRegistry', captured: true }),
        ],
        nonBinding: [
          {
            moduleId: 'orders',
            dependsOn: 'delivery_methods',
            name: 'shippingAdapterRegistry',
            kind: 'degrades-without',
            whenAbsent: 'no delivery method is offered at checkout',
            reason: 'declared',
          },
        ],
      }),
    );

    expect(ledger.unassigned[0]?.shape).toBe('captured-registration');
  });
});

describe('what the ledger deliberately does not classify', () => {
  it('leaves an edge whose owner can never be switched off alone (FR-021)', () => {
    const ledger = buildDeactivationLedger(
      input({
        reads: [read({ moduleId: 'blog', dependsOn: 'auth', name: 'requireAdmin', gated: true, site: 'wiring' })],
        declaredDependencies: new Map([['blog', ['auth']]]),
        neverAbsentOwners: new Set(['auth']),
      }),
    );

    expect(ledger.entries).toEqual([]);
    expect(ledger.unassigned).toEqual([]);
  });

  it('leaves a name the owning module does not register itself alone, and counts it', () => {
    const ledger = buildDeactivationLedger(
      input({
        reads: [read({ moduleId: 'stripe', dependsOn: 'sales_channels', name: 'salesChannelCodeIdPort' })],
        excludedNames: new Set(['salesChannelCodeIdPort']),
      }),
    );

    expect(ledger.entries).toEqual([]);
    expect(ledger.unassigned).toEqual([]);
    expect(ledger.excluded).toBe(1);
  });

  it('does not classify a module reading its own registration', () => {
    const ledger = buildDeactivationLedger(
      input({ reads: [read({ moduleId: 'orders', dependsOn: 'orders', name: 'orderService', gated: true })] }),
    );

    expect(ledger.entries).toEqual([]);
  });
});

describe('the read model the dialog and the 409 share', () => {
  const ledger = buildDeactivationLedger(
    input({
      reads: [
        read({ moduleId: 'stripe', dependsOn: 'payments', name: 'paymentService', gated: true }),
        read({ moduleId: 'tpay', dependsOn: 'payments', name: 'paymentService', gated: true }),
        read({ moduleId: 'returns', dependsOn: 'payments', name: 'paymentRefundPort', gated: true }),
        read({ moduleId: 'orders', dependsOn: 'prompt_actions', name: 'promptActionToolRegistry', site: 'boot' }),
      ],
      declaredDependencies: new Map([['invoices', ['payments']]]),
      nonBinding: [
        {
          moduleId: 'returns',
          dependsOn: 'payments',
          name: 'paymentRefundPort',
          kind: 'degrades-without',
          whenAbsent: 'a settled return is recorded for manual refund',
          reason: 'declared',
        },
      ],
      contributionPolicies: { 'prompt_actions:promptActionToolRegistry': 'skip' },
    }),
  );

  it('names every present dependent with a consequence, once each', () => {
    const rows = deactivationConsequencesFor(ledger.entries, 'payments', () => true);

    expect(rows).toEqual([
      { moduleId: 'returns', effect: 'degraded', description: 'a settled return is recorded for manual refund' },
      { moduleId: 'stripe', effect: 'unavailable', description: null },
      { moduleId: 'tpay', effect: 'unavailable', description: null },
    ]);
  });

  it('drops a dependent that is not effectively present', () => {
    const rows = deactivationConsequencesFor(ledger.entries, 'payments', (id) => id !== 'tpay');

    expect(rows.map((row) => row.moduleId)).toEqual(['returns', 'stripe']);
  });

  it('produces no row for a contribution or for a schema-only edge', () => {
    expect(deactivationConsequencesFor(ledger.entries, 'prompt_actions', () => true)).toEqual([]);
    expect(deactivationConsequencesFor(ledger.entries, 'payments', () => true).map((r) => r.moduleId)).not.toContain(
      'invoices',
    );
  });

  it('lets the pull decide when a dependent both contributes and pulls', () => {
    const both = buildDeactivationLedger(
      input({
        reads: [
          read({ moduleId: 'payments', dependsOn: 'payment_methods', name: 'paymentAdapterRegistry', site: 'boot' }),
          read({ moduleId: 'payments', dependsOn: 'payment_methods', name: 'paymentOrderStatusRegistry' }),
        ],
        contributionPolicies: {
          'payment_methods:paymentAdapterRegistry': 'skip',
          'payment_methods:paymentOrderStatusRegistry': 'skip',
        },
      }),
    );

    expect(deactivationConsequencesFor(both.entries, 'payment_methods', () => true)).toEqual([
      { moduleId: 'payments', effect: 'unavailable', description: null },
    ]);
  });
});
