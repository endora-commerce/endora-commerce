import type { LedgerDeliveryRecord } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

export function makeRetryInvoiceLedgerDeliveryCommand(input: {
  deliveryId: string;
  before: LedgerDeliveryRecord;
  retry: () => Promise<LedgerDeliveryRecord>;
}): Command<LedgerDeliveryRecord> {
  return {
    action: 'invoice_ledger.delivery.retry',
    objectType: 'invoice_ledger_delivery',
    objectId: input.deliveryId,
    capture: async () => ({
      status: input.before.status,
      credentialCode: input.before.credentialCode,
      environment: input.before.environment,
      ksefRouting: input.before.ksefRouting,
    }),
    run: async () => {
      const result = await input.retry();
      return {
        result,
        after: {
          status: result.status,
          credentialCode: result.credentialCode,
          environment: result.environment,
          ksefRouting: result.ksefRouting,
        },
      };
    },
  };
}
