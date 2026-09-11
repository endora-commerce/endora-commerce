import type { InvoiceLedgerRoutingDto } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

export function makeWriteInvoiceLedgerRoutingCommand(input: {
  before: InvoiceLedgerRoutingDto;
  write: () => Promise<InvoiceLedgerRoutingDto>;
}): Command<InvoiceLedgerRoutingDto> {
  return {
    action: 'invoice_ledger.routing.write',
    objectType: 'invoice_ledger_routing',
    objectId: 'invoice_ledger',
    capture: async () => ({ ...input.before }),
    run: async () => {
      const result = await input.write();
      return { result, after: { ...result } };
    },
  };
}
