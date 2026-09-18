import type { EntityManager } from '@mikro-orm/postgresql';
import {
  CAPABILITY_KEYS,
  ERROR_CODES,
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

/**
 * Feature 132 (T026) — **effective** presence, not the activation Setting alone.
 *
 * This read was `presence(moduleId)?.operatorActivated`, which answers `true` for
 * a module whose *platform* availability is off — a vendor the deployment never
 * installed holding a claim that refuses another. The conjunction is what
 * Principle XVII means by "a module that is off behaves as if never installed"
 * (spec FR-012), and `isPresent` is the one place the two axes are combined.
 *
 * The method name stays `isOperatorActivated` because it is the shape of an
 * injected seam three call sites and the test harness already pass; what it
 * answers is the conjunction now, and it says so.
 */
export const defaultInvoiceLedgerPresence: LedgerActivationPresenceReader = {
  isOperatorActivated(moduleId) {
    return effectiveState.isPresent(moduleId);
  },
};

/**
 * The vendor family, from the members' own manifest declarations.
 *
 * This was `INVOICE_LEDGER_MODULES`, a hand-written array in
 * `@endora-commerce/contracts` — and `invoice_ledger` was already the family whose
 * seam was open, because the member list was a constructor parameter and a
 * container value rather than an import inside the method. Feature 132 changes
 * what supplies it (`capability-exclusivity.md` R3), so a vendor installed from
 * npm joins by declaring `capabilities` and no file in this repository names it.
 */
export function declaredLedgerVendorModules(): readonly { id: string }[] {
  return effectiveState
    .declaredMembersOfCapability(CAPABILITY_KEYS.INVOICE_LEDGER_VENDOR)
    .map((id) => ({ id }));
}

export class InvoiceLedgerRegistryService implements InvoiceLedgerRegistryPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly presence: LedgerActivationPresenceReader = defaultInvoiceLedgerPresence,
    /**
     * The family. A **function** rather than an array, because the derived family
     * is re-installed by every `b2b:module:state-changed` refresh and a value
     * captured at construction would answer for the deployment as it was when this
     * singleton was built. Callers that pass an explicit list — the test harness
     * does, to add a sibling without shipping one — keep passing a list.
     */
    private readonly modules:
      | readonly { id: string }[]
      | (() => readonly { id: string }[]) = declaredLedgerVendorModules,
  ) {}

  private vendorModules(): readonly { id: string }[] {
    return typeof this.modules === 'function' ? this.modules() : this.modules;
  }

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
    for (const sibling of this.vendorModules()) {
      if (this.presence.isOperatorActivated(sibling.id)) {
        return sibling.id;
      }
    }
    return null;
  }

  private findActiveSibling(exceptModuleId: string): string | null {
    for (const sibling of this.vendorModules()) {
      if (sibling.id === exceptModuleId) continue;
      if (this.presence.isOperatorActivated(sibling.id)) {
        return sibling.id;
      }
    }
    return null;
  }
}
