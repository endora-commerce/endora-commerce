import {
  INVOICE_LEDGER_SETTING_CODES,
  invoiceLedgerKsefRoutingSchema,
  invoiceLedgerNumberingModeSchema,
  type InvoiceLedgerNativeKsefAction,
  type InvoiceLedgerNumberingMode,
  type InvoiceLedgerRegistryPort,
  type InvoiceLedgerRoutingPort,
} from '@endora-commerce/contracts';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';

export class InvoiceLedgerRoutingService implements InvoiceLedgerRoutingPort {
  constructor(
    private readonly settings: SettingsReadPort,
    private readonly registry: Pick<InvoiceLedgerRegistryPort, 'getActiveModuleId'>,
  ) {}

  async numberingModeFor(salesChannelId: string | null): Promise<InvoiceLedgerNumberingMode> {
    return this.settings.get(
      INVOICE_LEDGER_SETTING_CODES.NUMBERING_MODE,
      salesChannelId,
      invoiceLedgerNumberingModeSchema,
    );
  }

  async nativeKsefActionFor(salesChannelId: string | null): Promise<InvoiceLedgerNativeKsefAction> {
    const routing = await this.settings.get(
      INVOICE_LEDGER_SETTING_CODES.KSEF_ROUTING,
      salesChannelId,
      invoiceLedgerKsefRoutingSchema,
    );
    return routing === 'vendor' ? 'skip' : 'submit';
  }

  async activeVendorModuleId(): Promise<string | null> {
    return this.registry.getActiveModuleId();
  }
}
