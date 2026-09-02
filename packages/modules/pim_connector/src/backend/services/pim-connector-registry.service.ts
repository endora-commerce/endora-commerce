import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PIM_CONNECTOR_MODULES,
  type PimConnectorRegistryPort,
} from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import {
  PIM_CONNECTOR_ACTIVATION_LOCK_SINGLETON_ID,
  PimConnectorActivationLock,
} from '../entities/pim-connector-activation-lock.entity.js';

/**
 * How the registry asks whether a sibling PIM connector is operator-activated.
 * Defaults to the platform's effective-state conjunction so it stays in lockstep
 * with `/platform/modules` flips (which refresh presence immediately and do not
 * go through the settings cache the activation Command bypasses).
 */
export interface PimActivationPresenceReader {
  isOperatorActivated(moduleId: string): boolean;
}

const defaultPresenceReader: PimActivationPresenceReader = {
  isOperatorActivated(moduleId) {
    return effectiveState.presence(moduleId)?.operatorActivated ?? false;
  },
};

export class PimConnectorRegistryService implements PimConnectorRegistryPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly presence: PimActivationPresenceReader = defaultPresenceReader,
  ) {}

  async assertCanActivate(moduleId: string): Promise<void> {
    const activeSibling = this.findActiveSibling(moduleId);
    if (activeSibling !== null) {
      throw new HttpError(
        409,
        ERROR_CODES.PIM_CONNECTOR_ALREADY_ACTIVE,
        `Another PIM connector is already active: ${activeSibling}`,
        { activeModuleId: activeSibling },
      );
    }
  }

  async recordActive(moduleId: string, adminId: string | null): Promise<void> {
    const em = this.emFactory();
    let row = await em.findOne(PimConnectorActivationLock, {
      id: PIM_CONNECTOR_ACTIVATION_LOCK_SINGLETON_ID,
    });
    if (row === null) {
      // command-coverage-ignore: mutual-exclusion bookkeeping. Mirrors the operator's
      // PIM activation choice in the lock row; the activation write itself is audited.
      row = em.create(PimConnectorActivationLock, {
        id: PIM_CONNECTOR_ACTIVATION_LOCK_SINGLETON_ID,
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
    const row = await em.findOne(PimConnectorActivationLock, {
      id: PIM_CONNECTOR_ACTIVATION_LOCK_SINGLETON_ID,
    });
    if (row === null || row.activeModuleId !== moduleId) {
      return;
    }
    // command-coverage-ignore: mutual-exclusion bookkeeping. Clears the lock when the
    // named connector deactivates; the activation write itself is audited.
    row.activeModuleId = null;
    row.updatedAt = new Date();
    await em.flush();
  }

  async getActiveModuleId(): Promise<string | null> {
    const em = this.emFactory();
    const row = await em.findOne(PimConnectorActivationLock, {
      id: PIM_CONNECTOR_ACTIVATION_LOCK_SINGLETON_ID,
    });
    return row?.activeModuleId ?? null;
  }

  private findActiveSibling(exceptModuleId: string): string | null {
    for (const sibling of PIM_CONNECTOR_MODULES) {
      if (sibling.id === exceptModuleId) continue;
      if (this.presence.isOperatorActivated(sibling.id)) {
        return sibling.id;
      }
    }
    return null;
  }
}
