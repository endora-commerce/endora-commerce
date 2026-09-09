import type {
  InvoiceLedgerVendorFreeze,
  InvoiceLedgerVendorFreezeRegistryPort,
} from '@endora-commerce/contracts';

type FreezeResolver = (
  salesChannelId: string | null,
) => Promise<InvoiceLedgerVendorFreeze>;

export class InvoiceLedgerVendorFreezeRegistry implements InvoiceLedgerVendorFreezeRegistryPort {
  private readonly resolvers = new Map<string, FreezeResolver>();

  register(adapterId: string, resolve: FreezeResolver, _module: string): void {
    this.resolvers.set(adapterId, resolve);
  }

  async resolve(
    adapterId: string,
    salesChannelId: string | null,
  ): Promise<InvoiceLedgerVendorFreeze | null> {
    const resolve = this.resolvers.get(adapterId);
    if (!resolve) return null;
    return resolve(salesChannelId);
  }
}
