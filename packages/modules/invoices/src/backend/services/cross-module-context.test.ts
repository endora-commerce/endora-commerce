import { describe, expect, it, vi } from 'vitest';
import type { AssetReadPort, CustomerAccountReadPort, OrderRecord } from '@endora-commerce/contracts';

import {
  createAssetImageLoader,
  createChannelLanguageResolver,
  createRecipientEmailResolver,
} from './cross-module-context.js';

/**
 * The three mappings `invoicesBridge` used to hold, over stubs, composing
 * nothing (`specs/110-instance-repository/` T118c).
 *
 * This is the half `backend/test/integration/invoices/cross-module-wiring.test.ts`
 * cannot see, and the split is deliberate: that file proves that
 * `backend/index.ts` wires these into the module at all, and this one proves
 * what they answer — including the two `ModuleDisabledError` cases, which are
 * the whole reason none of the three carries a `catch`.
 */

class ModuleDisabledError extends Error {
  readonly code = 'MODULE_DISABLED';
  constructor(moduleId: string) {
    super(`[${moduleId}] is disabled`);
  }
}

const ORDER = { placedByCustomerAccountId: 'cust-1' } as unknown as OrderRecord;

describe('createRecipientEmailResolver', () => {
  it('maps the published account record to the address the dispatcher needs', async () => {
    const accounts = {
      findById: vi.fn(async () => ({ email: 'buyer@example.com' })),
    } as unknown as Pick<CustomerAccountReadPort, 'findById'>;

    await expect(createRecipientEmailResolver(accounts)(ORDER)).resolves.toBe(
      'buyer@example.com',
    );
    expect(accounts.findById).toHaveBeenCalledWith('cust-1');
  });

  it('answers null when no account resolves, rather than throwing', async () => {
    const accounts = { findById: async () => null } as unknown as Pick<
      CustomerAccountReadPort,
      'findById'
    >;

    // `no_recipient` at the dispatcher, not a failed issue: the document is
    // valid whether or not anyone can be told about it.
    await expect(createRecipientEmailResolver(accounts)(ORDER)).resolves.toBeNull();
  });

  it('lets a switched-off owner through instead of reading it as "no address"', async () => {
    const accounts = {
      findById: async () => {
        throw new ModuleDisabledError('customer_accounts');
      },
    } as unknown as Pick<CustomerAccountReadPort, 'findById'>;

    // The fail-open composition checklist item 7 refuses. `customer_accounts`
    // declares `nonDeactivatable`, so this cannot happen today; the assertion
    // is what keeps it fail-closed if that lock is ever withdrawn.
    await expect(createRecipientEmailResolver(accounts)(ORDER)).rejects.toThrow(
      /MODULE_DISABLED|disabled/,
    );
  });
});

describe('createChannelLanguageResolver', () => {
  function emFactory(defaultLanguage: string | null): {
    factory: () => never;
    queries: unknown[];
  } {
    const queries: unknown[] = [];
    const em = {
      findOne: async (_entity: unknown, where: unknown) => {
        queries.push(where);
        return defaultLanguage === null ? null : { defaultLanguage };
      },
    };
    return { factory: (() => em) as unknown as () => never, queries };
  }

  it('reads the channel’s default language', async () => {
    const { factory, queries } = emFactory('pl-PL');

    await expect(createChannelLanguageResolver(factory)('ch-1')).resolves.toBe('pl-PL');
    expect(queries).toEqual([{ id: 'ch-1' }]);
  });

  it('falls back to en-US for an invoice with no channel, reading nothing', async () => {
    const { factory, queries } = emFactory('pl-PL');

    await expect(createChannelLanguageResolver(factory)(null)).resolves.toBe('en-US');
    expect(queries, 'a null channel must not produce a query').toEqual([]);
  });

  it('falls back to en-US for a channel that is not there', async () => {
    const { factory } = emFactory(null);

    await expect(createChannelLanguageResolver(factory)('ch-gone')).resolves.toBe('en-US');
  });
});

describe('createAssetImageLoader', () => {
  function assets(
    record: { mimeType: string } | null,
    bytes: { bytes: Uint8Array; mimeType: string } | null = null,
  ): { port: Pick<AssetReadPort, 'findById' | 'openAssetBytes'>; opened: string[] } {
    const opened: string[] = [];
    return {
      opened,
      port: {
        findById: (async (_id: string, options?: { liveOnly?: boolean }) => {
          expect(options, 'a soft-deleted logo must not resolve').toEqual({ liveOnly: true });
          return record;
        }) as unknown as AssetReadPort['findById'],
        openAssetBytes: async (id: string) => {
          opened.push(id);
          return bytes;
        },
      },
    };
  }

  it('asks the cheap question first and then moves the bytes', async () => {
    const { port, opened } = assets({ mimeType: 'image/png' }, {
      bytes: new Uint8Array([1, 2]),
      mimeType: 'image/png',
    });

    await expect(createAssetImageLoader(port)('a-1')).resolves.toEqual({
      bytes: new Uint8Array([1, 2]),
      mimeType: 'image/png',
    });
    expect(opened).toEqual(['a-1']);
  });

  it('refuses a non-image without streaming it', async () => {
    const { port, opened } = assets({ mimeType: 'text/plain' });

    await expect(createAssetImageLoader(port)('a-2')).resolves.toBeNull();
    // The order is the point: an operator can point the logo slot at anything,
    // and the metadata read is what stops it reaching this process.
    expect(opened, 'a non-image must not be opened at all').toEqual([]);
  });

  it('answers null for an asset that is not there', async () => {
    const { port, opened } = assets(null);

    await expect(createAssetImageLoader(port)('a-3')).resolves.toBeNull();
    expect(opened).toEqual([]);
  });

  it('answers null when the owner could not produce bytes', async () => {
    // `openAssetBytes` owns that degrade — a `legacy` row, or a store that
    // would not stream. This loader carries no `catch` of its own and needs
    // none.
    const { port } = assets({ mimeType: 'image/png' }, null);

    await expect(createAssetImageLoader(port)('a-4')).resolves.toBeNull();
  });

  it('lets a switched-off owner through instead of reading it as "no logo"', async () => {
    const port: Pick<AssetReadPort, 'findById' | 'openAssetBytes'> = {
      findById: async () => {
        throw new ModuleDisabledError('assets_library');
      },
      openAssetBytes: async () => null,
    };

    await expect(createAssetImageLoader(port)('a-5')).rejects.toThrow(/MODULE_DISABLED|disabled/);
  });
});
