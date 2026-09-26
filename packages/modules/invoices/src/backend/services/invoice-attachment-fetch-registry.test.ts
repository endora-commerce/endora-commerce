import { describe, expect, it, vi } from 'vitest';
import type { InvoiceAttachmentFetchPort } from '@endora-commerce/contracts';
import {
  InvoiceAttachmentFetchConflictError,
  InvoiceAttachmentFetchRegistry,
  type InvoiceAttachmentFetchContextResolver,
} from './invoice-attachment-fetch-registry.js';

/**
 * The invoice attachment seam (feature 134, T061; `research.md` D12).
 *
 * `invoices` owns the lazy first-download of an ERP-imported sale document's
 * attachment bytes. A connector contributes the fetch for the source system it
 * imported the document from; this registry is the only thing the customer route
 * calls. Every case D12 names is here: no provider, a present provider, a
 * provider switched off and back on with no restart, a foreign organization, an
 * unknown source system, and a conflicting registration.
 */

const INPUT = {
  invoiceId: 'inv-1',
  attachmentId: 'att-1',
  organizationId: 'org-1',
} as const;

/** A context resolver standing in for the invoice-owned ownership check. */
function contextFor(
  owned: Record<string, string>,
): InvoiceAttachmentFetchContextResolver {
  return async (input) => {
    const system = owned[`${input.organizationId}:${input.invoiceId}:${input.attachmentId}`];
    return system === undefined ? null : { system };
  };
}

function provider(assetId: string): InvoiceAttachmentFetchPort & {
  ensureAttachmentBytes: ReturnType<typeof vi.fn>;
} {
  return { ensureAttachmentBytes: vi.fn(async () => ({ assetId })) };
}

const OWNED = contextFor({ 'org-1:inv-1:att-1': 'erp_one' });

describe('InvoiceAttachmentFetchRegistry', () => {
  it('answers null when no provider is registered', async () => {
    const registry = new InvoiceAttachmentFetchRegistry(OWNED);
    await expect(registry.ensureAttachmentBytes(INPUT)).resolves.toBeNull();
  });

  it('dispatches to the provider registered for the document’s source system', async () => {
    const one = provider('asset-one');
    const registry = new InvoiceAttachmentFetchRegistry(OWNED);
    registry.register({ system: 'erp_one', moduleId: 'erp_one_module', provider: one });

    await expect(registry.ensureAttachmentBytes(INPUT)).resolves.toEqual({ assetId: 'asset-one' });
    expect(one.ensureAttachmentBytes).toHaveBeenCalledWith(INPUT);
  });

  it('reads the contributor’s presence on every call, so switching it off and on needs no restart', async () => {
    const one = provider('asset-one');
    let present = false;
    const registry = new InvoiceAttachmentFetchRegistry(OWNED, (moduleId) =>
      moduleId === 'erp_one_module' ? present : true,
    );
    registry.register({ system: 'erp_one', moduleId: 'erp_one_module', provider: one });

    await expect(registry.ensureAttachmentBytes(INPUT)).resolves.toBeNull();
    expect(one.ensureAttachmentBytes).not.toHaveBeenCalled();

    present = true;
    await expect(registry.ensureAttachmentBytes(INPUT)).resolves.toEqual({ assetId: 'asset-one' });

    present = false;
    await expect(registry.ensureAttachmentBytes(INPUT)).resolves.toBeNull();
    expect(one.ensureAttachmentBytes).toHaveBeenCalledTimes(1);
  });

  it('never falls back to another provider when the document’s own is off', async () => {
    const one = provider('asset-one');
    const two = provider('asset-two');
    const registry = new InvoiceAttachmentFetchRegistry(
      OWNED,
      (moduleId) => moduleId !== 'erp_one_module',
    );
    registry.register({ system: 'erp_one', moduleId: 'erp_one_module', provider: one });
    registry.register({ system: 'erp_two', moduleId: 'erp_two_module', provider: two });

    await expect(registry.ensureAttachmentBytes(INPUT)).resolves.toBeNull();
    expect(one.ensureAttachmentBytes).not.toHaveBeenCalled();
    expect(two.ensureAttachmentBytes).not.toHaveBeenCalled();
  });

  it('refuses a foreign organization before any provider does remote work', async () => {
    const one = provider('asset-one');
    const registry = new InvoiceAttachmentFetchRegistry(OWNED);
    registry.register({ system: 'erp_one', moduleId: 'erp_one_module', provider: one });

    await expect(
      registry.ensureAttachmentBytes({ ...INPUT, organizationId: 'org-foreign' }),
    ).resolves.toBeNull();
    expect(one.ensureAttachmentBytes).not.toHaveBeenCalled();
  });

  it('answers null for a source system no provider registered', async () => {
    const one = provider('asset-one');
    const registry = new InvoiceAttachmentFetchRegistry(
      contextFor({ 'org-1:inv-1:att-1': 'erp_unknown' }),
    );
    registry.register({ system: 'erp_one', moduleId: 'erp_one_module', provider: one });

    await expect(registry.ensureAttachmentBytes(INPUT)).resolves.toBeNull();
    expect(one.ensureAttachmentBytes).not.toHaveBeenCalled();
  });

  it('rejects a second provider for one source system instead of letting composition order decide', () => {
    const registry = new InvoiceAttachmentFetchRegistry(OWNED);
    registry.register({ system: 'erp_one', moduleId: 'erp_one_module', provider: provider('a') });

    expect(() =>
      registry.register({ system: 'erp_one', moduleId: 'other_module', provider: provider('b') }),
    ).toThrow(InvoiceAttachmentFetchConflictError);
    expect(() =>
      registry.register({ system: 'erp_one', moduleId: 'erp_one_module', provider: provider('c') }),
    ).toThrow(InvoiceAttachmentFetchConflictError);
  });

  it('accepts the identical registration twice', async () => {
    const one = provider('asset-one');
    const registry = new InvoiceAttachmentFetchRegistry(OWNED);
    const registration = { system: 'erp_one', moduleId: 'erp_one_module', provider: one };
    registry.register(registration);
    expect(() => registry.register({ ...registration })).not.toThrow();
    await expect(registry.ensureAttachmentBytes(INPUT)).resolves.toEqual({ assetId: 'asset-one' });
  });
});
