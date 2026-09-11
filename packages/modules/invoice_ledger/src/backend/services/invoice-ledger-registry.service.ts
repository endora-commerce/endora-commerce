import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  INVOICE_LEDGER_MODULES,
  type InvoiceLedgerRegistryPort,
} from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import {
  INVOICE_LEDGER_ACTIVATION_LOCK_SINGLETON_ID,
  InvoiceLedgerActivationLock,
} from '../entities/invoice-ledger-activation-lock.entity.js';

export interface LedgerActivationPresenceReader {
  isOperatorActivated(moduleId: string): boolean;
}

export const defaultInvoiceLedgerPresence: LedgerActivationPresenceReader = {
  isOperatorActivated(moduleId) {
    return effectiveState.presence(moduleId)?.operatorActivated ?? false;
  },
};

export class InvoiceLedgerRegistryService implements InvoiceLedgerRegistryPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly presence: LedgerActivationPresenceReader = defaultInvoiceLedgerPresence,
    private readonly modules: readonly { id: string }[] = INVOICE_LEDGER_MODULES,
  ) {}

  async assertCanActivate(moduleId: string): Promise<void> {
    const activeSibling = this.findActiveSibling(moduleId);
    if (activeSibling !== null) {
      throw new HttpError(
        409,
        ERROR_CODES.INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE,
        `Another invoice ledger vendor is already active: ${activeSibling}`,
        { activeModuleId: activeSibling },
      );
    }
  }

  async recordActive(moduleId: string, adminId: string | null): Promise<void> {
    const em = this.emFactory();
    let row = await em.findOne(InvoiceLedgerActivationLock, {
      id: INVOICE_LEDGER_ACTIVATION_LOCK_SINGLETON_ID,
    });
    if (row === null) {
      // command-coverage-ignore: mutual-exclusion bookkeeping. Mirrors the operator's
      // vendor activation choice in the lock row; the activation write itself is audited.
      row = em.create(InvoiceLedgerActivationLock, {
        id: INVOICE_LEDGER_ACTIVATION_LOCK_SINGLETON_ID,
        activeModuleId: moduleId,
        updatedByAdminId: adminId,
        updatedAt: new Date(),
      });
    } else {
      row.activeModuleId = moduleId;
      row.updatedByAdminId = adminId;
      row.updatedAt = new Date();
    }
    await em.flush();
  }

  async clearActive(moduleId: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(InvoiceLedgerActivationLock, {
      id: INVOICE_LEDGER_ACTIVATION_LOCK_SINGLETON_ID,
    });
    if (row === null || row.activeModuleId !== moduleId) {
      return;
    }
    // command-coverage-ignore: mutual-exclusion bookkeeping. Clears the lock when the
    // named vendor deactivates; the activation write itself is audited.
    row.activeModuleId = null;
    row.updatedAt = new Date();
    await em.flush();
  }

  async getActiveModuleId(): Promise<string | null> {
    for (const sibling of this.modules) {
      if (this.presence.isOperatorActivated(sibling.id)) {
        return sibling.id;
      }
    }
    return null;
  }

  private findActiveSibling(exceptModuleId: string): string | null {
    for (const sibling of this.modules) {
      if (sibling.id === exceptModuleId) continue;
      if (this.presence.isOperatorActivated(sibling.id)) {
        return sibling.id;
      }
    }
    return null;
  }
}
