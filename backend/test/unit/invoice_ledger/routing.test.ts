import { describe, expect, it } from 'vitest';
import {
  INVOICE_LEDGER_SETTING_CODES,
  type InvoiceLedgerKsefRouting,
  type InvoiceLedgerNumberingMode,
} from '@endora-commerce/contracts';
import { InvoiceLedgerRoutingService } from '../../../../packages/modules/invoice_ledger/src/backend/services/invoice-ledger-routing.service.js';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';

const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';

function settingsMap(values: {
  instanceNumbering?: InvoiceLedgerNumberingMode;
  instanceKsef?: InvoiceLedgerKsefRouting;
  channelNumbering?: InvoiceLedgerNumberingMode;
  channelKsef?: InvoiceLedgerKsefRouting;
}): SettingsReadPort {
  return {
    async get(code, salesChannelId) {
      if (code === INVOICE_LEDGER_SETTING_CODES.NUMBERING_MODE) {
        if (salesChannelId === CHANNEL_ID && values.channelNumbering !== undefined) {
          return values.channelNumbering;
        }
        return values.instanceNumbering ?? 'endora';
      }
      if (code === INVOICE_LEDGER_SETTING_CODES.KSEF_ROUTING) {
        if (salesChannelId === CHANNEL_ID && values.channelKsef !== undefined) {
          return values.channelKsef;
        }
        return values.instanceKsef ?? 'native';
      }
      throw new Error(`unexpected setting ${code}`);
    },
    async getMany() {
      return new Map();
    },
  };
}

describe('invoice_ledger routing', () => {
  it('reads channel override then instance default for numbering', async () => {
    const service = new InvoiceLedgerRoutingService(
      settingsMap({
        instanceNumbering: 'endora',
        channelNumbering: 'vendor',
      }),
      { getActiveModuleId: async () => 'infakt' },
    );

    await expect(service.numberingModeFor(CHANNEL_ID)).resolves.toBe('vendor');
    await expect(service.numberingModeFor(null)).resolves.toBe('endora');
  });

  it('numberingModeFor may return endora when no vendor is active', async () => {
    const service = new InvoiceLedgerRoutingService(
      settingsMap({ instanceNumbering: 'endora' }),
      { getActiveModuleId: async () => null },
    );

    await expect(service.numberingModeFor(null)).resolves.toBe('endora');
  });

  it('nativeKsefActionFor follows invoice_ledger.ksef.routing only (F1)', async () => {
    const vendorRouting = new InvoiceLedgerRoutingService(
      settingsMap({ instanceKsef: 'vendor' }),
      { getActiveModuleId: async () => null },
    );
    await expect(vendorRouting.nativeKsefActionFor(null)).resolves.toBe('skip');

    const nativeRouting = new InvoiceLedgerRoutingService(
      settingsMap({ instanceKsef: 'native' }),
      { getActiveModuleId: async () => 'infakt' },
    );
    await expect(nativeRouting.nativeKsefActionFor(null)).resolves.toBe('submit');
  });

  it('channel KSeF override wins over the instance default', async () => {
    const service = new InvoiceLedgerRoutingService(
      settingsMap({
        instanceKsef: 'native',
        channelKsef: 'vendor',
      }),
      { getActiveModuleId: async () => 'infakt' },
    );

    await expect(service.nativeKsefActionFor(CHANNEL_ID)).resolves.toBe('skip');
    await expect(service.nativeKsefActionFor(null)).resolves.toBe('submit');
  });
});
