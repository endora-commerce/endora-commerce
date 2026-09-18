import type { EntityManager } from '@mikro-orm/postgresql';
import {
  CAPABILITY_KEYS,
  ERROR_CODES,
  type PimConnectorRegistryPort,
} from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import {
  PIM_CONNECTOR_ACTIVATION_LOCK_SINGLETON_ID,
  PimConnectorActivationLock,
} from '../entities/pim-connector-activation-lock.entity.js';

/**
 * How the registry asks **who is in the family and present** (feature 132,
 * `capability-exclusivity.md` R2.1–R2.2).
 *
 * Two things moved here and both were defects.
 *
 * The member list was `PIM_CONNECTOR_MODULES`, a hand-written array in
 * `@endora-commerce/contracts` that named two of the four shipped connectors — so
 * exclusivity covered 2 of the 12 ordered pairs, a connector outside this
 * repository could not join at all, and an overlay module had to edit a core file
 * to. It is now the members' own manifest declarations, derived on every
 * composition, so a connector that declares membership is covered **by existing**.
 *
 * The axis was `presence(id)?.operatorActivated`, which answers `true` for a
 * module whose *platform* availability is off — a connector the deployment never
 * installed holding a claim that refuses another. It is now the conjunction
 * `effectiveState.membersOfCapability` computes: a module that is off behaves as
 * if never installed (Principle XVII, spec FR-012).
 *
 * The default reads the platform's effective state directly, so it stays in
 * lockstep with `/platform/modules` flips — those refresh presence immediately
 * and do not go through the settings cache the activation Command bypasses.
 */
export interface PimConnectorFamilyReader {
  /** The family members whose **effective** presence is true, in manifest order. */
  activeMembers(): readonly string[];
}

const defaultFamilyReader: PimConnectorFamilyReader = {
  activeMembers() {
    return effectiveState.membersOfCapability(CAPABILITY_KEYS.PIM_CONNECTOR);
  },
};

export class PimConnectorRegistryService implements PimConnectorRegistryPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly family: PimConnectorFamilyReader = defaultFamilyReader,
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

  /**
   * The member holding the claim, or `null`.
   *
   * `exceptModuleId` is excluded even though an effectively-present module is by
   * definition not the one being switched on: the activation route is idempotent,
   * so `POST {active:true}` against the module that already holds the claim must
   * not be refused by the claim it holds.
   */
  private findActiveSibling(exceptModuleId: string): string | null {
    for (const moduleId of this.family.activeMembers()) {
      if (moduleId === exceptModuleId) continue;
      return moduleId;
    }
    return null;
  }
}
