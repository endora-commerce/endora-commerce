import { describe, expect, it, vi } from 'vitest';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { QuoteRequestCommandService } from './quote-request-command-port.js';

/**
 * `specs/192-quote-request-draft-share/` (FR-005, owner decision 2026-11-26
 * "port option 1") — `quoteRequestCommandPort.create` makes an unshared quote,
 * as the admin route does: nothing is recorded for its customer, so the runner
 * wakes no delivery after the commit. The port offers no `share`; an operator
 * shares in the Admin UI. The Command's own writes are measured in
 * `commands/quote-request-admin-commands.test.ts` and, against the database,
 * in `backend/test/contract/quote_requests/quote-request-command-port.test.ts`.
 */

const ORG = '00000000-0000-4000-8000-000000000192';
const CUSTOMER = '00000000-0000-4000-8000-000000000193';
const PRODUCT = '00000000-0000-4000-8000-000000000194';

function port() {
  const quote = Object.assign(new QuoteRequest(), {
    organizationId: ORG,
    customerAccountId: CUSTOMER,
    status: 'Created from admin',
    sharedWithCustomer: false,
  });
  const runWrite = vi.fn(async () => quote);
  const service = new QuoteRequestCommandService({
    admin: () => ({ commandDeps: {} as never, runWrite: runWrite as never }),
    documents: () => ({ send: vi.fn() }) as never,
    operator: async () => ({ adminUserId: null, roleLabel: 'System' }),
  });
  return { service, runWrite };
}

describe('quoteRequestCommandPort — sharing (192)', () => {
  it('create runs the Command without waking notification delivery', async () => {
    const { service, runWrite } = port();
    const record = await service.create({
      organizationId: ORG,
      customerAccountId: CUSTOMER,
      items: [{ productId: PRODUCT, quantity: 1 }],
    } as never);

    expect(runWrite).toHaveBeenCalledTimes(1);
    expect(runWrite).toHaveBeenCalledWith(expect.objectContaining({ action: 'quote_request.create_on_behalf' }), {
      notifies: false,
    });
    expect(record).toMatchObject({ sharedWithCustomer: false, expiresAt: null });
  });

  it('offers no share: an operator shares the quote in the Admin UI', () => {
    expect('share' in port().service).toBe(false);
  });
});
