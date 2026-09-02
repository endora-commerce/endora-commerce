import type { ModuleContext } from '@endora-commerce/platform/kernel';
import {
  PIM_CONNECTOR_REGISTRY_PORT,
  type PimConnectorRegistryPort,
} from '@endora-commerce/contracts';
import { PimConnectorActivationLock } from './entities/pim-connector-activation-lock.entity.js';
import { PimConnectorRegistryService } from './services/pim-connector-registry.service.js';

export {
  canonicalisePimFieldPath,
  isValidPimFieldPath,
} from './services/field-path.js';

interface PimConnectorCradle {
  emFactory: () => import('@mikro-orm/postgresql').EntityManager;
  pimConnectorRegistryPort: PimConnectorRegistryPort;
}

interface ModuleActivationChangedPayload {
  moduleId?: string;
  active?: boolean;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort<PimConnectorRegistryPort>(
    PIM_CONNECTOR_REGISTRY_PORT,
    ctx
      .asFunction(({ emFactory }: PimConnectorCradle) => new PimConnectorRegistryService(emFactory))
      .singleton(),
  );

  /**
   * Feature 089 / T079 — mirror UnoPim's successful activation flip onto the
   * diagnostic lock row. Owned here (always present) so the handler still runs
   * when the event fires before local presence has refreshed after activate,
   * and after deactivate when UnoPim itself is already absent.
   */
  ctx.subscribe('module.activation.changed', async (payload) => {
    const event = payload as ModuleActivationChangedPayload;
    if (event.moduleId !== 'pim_unopim' || typeof event.active !== 'boolean') return;
    const registry = ctx.cradle<PimConnectorCradle>().pimConnectorRegistryPort;
    if (event.active) {
      await registry.recordActive('pim_unopim', null);
    } else {
      await registry.clearActive('pim_unopim');
    }
  });
}

export const entities = [PimConnectorActivationLock];
