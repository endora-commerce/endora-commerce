import {
  ERROR_CODES,
  INVOICE_LEDGER_SETTING_CODES,
  invoiceLedgerKsefRoutingSchema,
  invoiceLedgerNumberingModeSchema,
  type InvoiceLedgerChannelOverride,
  type InvoiceLedgerRoutingDto,
  type InvoiceLedgerRoutingWriteBody,
  type SettingsAdminPort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { makeWriteInvoiceLedgerRoutingCommand } from '../commands/routing.commands.js';
import type { InvoiceLedgerRoutingService } from './invoice-ledger-routing.service.js';

const AUDIT = { actorAdminUserId: null as string | null };

export class InvoiceLedgerRoutingWriteService {
  constructor(
    private readonly routing: InvoiceLedgerRoutingService,
    private readonly settingsAdmin: SettingsAdminPort,
    private readonly emFactory: () => EntityManager,
    private readonly commandBus: CommandBus,
  ) {}

  async view(): Promise<InvoiceLedgerRoutingDto> {
    const numberingMode = await this.routing.numberingModeFor(null);
    const ksefRouting =
      (await this.routing.nativeKsefActionFor(null)) === 'skip' ? 'vendor' : 'native';
    const channels = await this.emFactory().find(SalesChannel, {});
    const channelOverrides: InvoiceLedgerChannelOverride[] = [];
    for (const channel of channels) {
      const channelNumbering = await this.routing.numberingModeFor(channel.id);
      const channelKsef =
        (await this.routing.nativeKsefActionFor(channel.id)) === 'skip' ? 'vendor' : 'native';
      const entry: InvoiceLedgerChannelOverride = { salesChannelId: channel.id };
      let present = false;
      if (channelNumbering !== numberingMode) {
        entry.numberingMode = channelNumbering;
        present = true;
      }
      if (channelKsef !== ksefRouting) {
        entry.ksefRouting = channelKsef;
        present = true;
      }
      if (present) channelOverrides.push(entry);
    }
    return {
      numberingMode,
      ksefRouting,
      activeVendorModuleId: await this.routing.activeVendorModuleId(),
      channelOverrides,
    };
  }

  async write(body: InvoiceLedgerRoutingWriteBody): Promise<InvoiceLedgerRoutingDto> {
    const before = await this.view();
    return this.commandBus.run(
      makeWriteInvoiceLedgerRoutingCommand({
        before,
        write: () => this.persist(before, body),
      }),
    );
  }

  private async persist(
    before: InvoiceLedgerRoutingDto,
    body: InvoiceLedgerRoutingWriteBody,
  ): Promise<InvoiceLedgerRoutingDto> {
    if (
      body.numberingMode !== undefined &&
      body.numberingMode !== before.numberingMode &&
      body.confirm !== true
    ) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'Confirm the numbering mode change.',
        { field: 'confirm' },
      );
    }

    if (body.numberingMode !== undefined) {
      invoiceLedgerNumberingModeSchema.parse(body.numberingMode);
      await this.settingsAdmin.setValueForAllChannels(
        INVOICE_LEDGER_SETTING_CODES.NUMBERING_MODE,
        body.numberingMode,
        null,
        AUDIT,
      );
    }
    if (body.ksefRouting !== undefined) {
      invoiceLedgerKsefRoutingSchema.parse(body.ksefRouting);
      await this.settingsAdmin.setValueForAllChannels(
        INVOICE_LEDGER_SETTING_CODES.KSEF_ROUTING,
        body.ksefRouting,
        null,
        AUDIT,
      );
    }

    if (body.channelOverrides) {
      for (const override of body.channelOverrides) {
        const channel = await this.emFactory().findOne(SalesChannel, {
          id: override.salesChannelId,
        });
        if (!channel) {
          throw new HttpError(
            400,
            ERROR_CODES.VALIDATION_FAILED,
            'Unknown sales channel for a routing override.',
            { field: 'channelOverrides' },
          );
        }
        if (override.numberingMode !== undefined) {
          await this.settingsAdmin.setValueForSubset(
            INVOICE_LEDGER_SETTING_CODES.NUMBERING_MODE,
            [channel.code],
            override.numberingMode,
            null,
            AUDIT,
          );
        }
        if (override.ksefRouting !== undefined) {
          await this.settingsAdmin.setValueForSubset(
            INVOICE_LEDGER_SETTING_CODES.KSEF_ROUTING,
            [channel.code],
            override.ksefRouting,
            null,
            AUDIT,
          );
        }
      }
    }

    return this.view();
  }
}
