import type { EntityManager } from '@mikro-orm/postgresql';
import {
  CAPABILITY_KEYS,
  ERROR_CODES,
  type ErpConnectorRegistryPort,
} from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import {
  ERP_CONNECTOR_ACTIVATION_LOCK_SINGLETON_ID,
  ErpConnectorActivationLock,
} from '../entities/erp-connector-activation-lock.entity.js';

export interface ErpActivationPresenceReader {
  isOperatorActivated(moduleId: string): boolean;
}

/**
 * Feature 132 (T027) — **effective** presence, not the activation Setting alone.
 *
 * `presence(moduleId)?.operatorActivated` answers `true` for a module whose
 * platform availability is off, so a connector the deployment never installed held
 * a claim that refused another. `isPresent` is the conjunction Principle XVII
 * means and the one place the two axes are combined (spec FR-012).
 */
const defaultPresenceReader: ErpActivationPresenceReader = {
  isOperatorActivated(moduleId) {
    return effectiveState.isPresent(moduleId);
  },
};

/**
 * The ERP family, from the members' own manifest declarations.
 *
 * This was `ERP_CONNECTOR_MODULES` in `@endora-commerce/contracts`, and this family
 * is the one whose array carried a live Principle XV violation: an **overlay**
 * module of the `example` deployment had to be written into that core file to join,
 * because there was no other way in. It declares `capabilities` in its own manifest
 * now and core is untouched.
 */
export function declaredErpConnectorModules(): ReadonlyArray<{ id: string }> {
  return effectiveState
    .declaredMembersOfCapability(CAPABILITY_KEYS.ERP_CONNECTOR)
    .map((id) => ({ id }));
}

export class ErpConnectorRegistryService implements ErpConnectorRegistryPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly presence: ErpActivationPresenceReader = defaultPresenceReader,
    /**
     * A **function**, because the derived family is re-installed by every
     * `b2b:module:state-changed` refresh and a list captured when this singleton was
     * built would answer for the deployment as it was then.
     */
    private readonly modules:
      | ReadonlyArray<{ id: string }>
      | (() => ReadonlyArray<{ id: string }>) = declaredErpConnectorModules,
  ) {}

  private connectorModules(): ReadonlyArray<{ id: string }> {
    return typeof this.modules === 'function' ? this.modules() : this.modules;
  }

  async assertCanActivate(moduleId: string): Promise<void> {
    const activeSibling = this.findActiveSibling(moduleId);
    if (activeSibling !== null) {
      throw new HttpError(
        409,
        ERROR_CODES.ERP_CONNECTOR_ALREADY_ACTIVE,
        `Another ERP connector is already active: ${activeSibling}`,
        { activeModuleId: activeSibling },
      );
    }
  }

  async recordActive(moduleId: string, adminId: string | null): Promise<void> {
    const em = this.emFactory();
    let row = await em.findOne(ErpConnectorActivationLock, {
      id: ERP_CONNECTOR_ACTIVATION_LOCK_SINGLETON_ID,
    });
    if (row === null) {
      // command-coverage-ignore: mutual-exclusion bookkeeping mirrors operator activation.
      row = em.create(ErpConnectorActivationLock, {
        id: ERP_CONNECTOR_ACTIVATION_LOCK_SINGLETON_ID,
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
    const row = await em.findOne(ErpConnectorActivationLock, {
      id: ERP_CONNECTOR_ACTIVATION_LOCK_SINGLETON_ID,
    });
    if (row === null || row.activeModuleId !== moduleId) {
      return;
    }
    // command-coverage-ignore: mutual-exclusion bookkeeping clears the lock on deactivation.
    row.activeModuleId = null;
    row.updatedAt = new Date();
    await em.flush();
  }

  async getActiveModuleId(): Promise<string | null> {
    const em = this.emFactory();
    const row = await em.findOne(ErpConnectorActivationLock, {
      id: ERP_CONNECTOR_ACTIVATION_LOCK_SINGLETON_ID,
    });
    return row?.activeModuleId ?? null;
  }

  private findActiveSibling(exceptModuleId: string): string | null {
    for (const sibling of this.connectorModules()) {
      if (sibling.id === exceptModuleId) continue;
      if (this.presence.isOperatorActivated(sibling.id)) {
        return sibling.id;
      }
    }
    return null;
  }
}
