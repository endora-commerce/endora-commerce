import type { InvoiceLedgerRegistryPort } from '@endora-commerce/contracts';
import type { ModuleContext } from '../../../../kernel/index.js';
import { lazyPort } from '../../../../kernel/index.js';

/**
 * `ledger_challenger_fixture`'s composition — seam 3 of `ledger_vendor_fixture`'s
 * four, and only that one (feature 134, `research.md` D23 §2). Read `manifest.ts`
 * for why.
 */

export const LEDGER_CHALLENGER_FIXTURE_MODULE_ID = 'ledger_challenger_fixture';

export function registerModule(ctx: ModuleContext): void {
  /**
   * The exclusive capability's enforcement, which is each member's own:
   * `invoice_ledger` mints the refusal, and only the vendor knows which activation
   * request is about it. The same block `ledger_vendor_fixture` carries.
   */
  ctx.interceptors([
    {
      id: 'refuse-when-sibling-ledger-vendor-active',
      target: 'POST /api/v1/admin/modules/:id/activation',
      phase: 'pre',
      handler: async (interceptorCtx: { params: unknown; body: unknown }): Promise<void> => {
        const { params, body } = interceptorCtx;
        const moduleId =
          params !== null && typeof params === 'object' && 'id' in params
            ? String((params as { id: unknown }).id)
            : '';
        const active =
          body !== null &&
          typeof body === 'object' &&
          'active' in body &&
          (body as { active: unknown }).active === true;
        if (moduleId !== LEDGER_CHALLENGER_FIXTURE_MODULE_ID || !active) return;
        await lazyPort<InvoiceLedgerRegistryPort>(
          ctx,
          'invoiceLedgerRegistryPort',
        ).assertCanActivate(LEDGER_CHALLENGER_FIXTURE_MODULE_ID);
      },
    },
  ]);
}
