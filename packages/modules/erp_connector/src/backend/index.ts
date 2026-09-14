import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { ErpConnectorRegistryPort } from '@endora-commerce/contracts';
import { ErpConnectorActivationLock } from './entities/erp-connector-activation-lock.entity.js';
import { ErpConnectorRegistryService } from './services/erp-connector-registry.service.js';

interface ErpConnectorCradle {
  emFactory: () => import('@mikro-orm/postgresql').EntityManager;
}

interface ModuleActivationChangedPayload {
  moduleId?: string;
  active?: boolean;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort<ErpConnectorRegistryPort>(
    'erpConnectorRegistryPort',
    ctx
      .asFunction(({ emFactory }: ErpConnectorCradle) => new ErpConnectorRegistryService(emFactory))
      .singleton(),
  );

  ctx.subscribe('module.activation.changed', async (payload) => {
    const event = payload as ModuleActivationChangedPayload;
    if (event.moduleId !== 'comarch_xl' || typeof event.active !== 'boolean') return;
    const registry = ctx.cradle<{ erpConnectorRegistryPort: ErpConnectorRegistryPort }>()
      .erpConnectorRegistryPort;
    if (event.active) {
      await registry.recordActive('comarch_xl', null);
    } else {
      await registry.clearActive('comarch_xl');
    }
  });
}

export const entities = [ErpConnectorActivationLock];
