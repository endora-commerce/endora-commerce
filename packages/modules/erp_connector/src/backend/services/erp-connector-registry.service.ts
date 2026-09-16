import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  ERP_CONNECTOR_MODULES,
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

const defaultPresenceReader: ErpActivationPresenceReader = {
  isOperatorActivated(moduleId) {
    return effectiveState.presence(moduleId)?.operatorActivated ?? false;
  },
};

export class ErpConnectorRegistryService implements ErpConnectorRegistryPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly presence: ErpActivationPresenceReader = defaultPresenceReader,
    private readonly modules: ReadonlyArray<{ id: string }> = ERP_CONNECTOR_MODULES,
  ) {}

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
    for (const sibling of this.modules) {
      if (sibling.id === exceptModuleId) continue;
      if (this.presence.isOperatorActivated(sibling.id)) {
        return sibling.id;
      }
    }
    return null;
  }
}
