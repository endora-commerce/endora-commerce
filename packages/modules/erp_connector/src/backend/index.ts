import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import {
  ERP_CONNECTOR_MODULES,
  type ErpConnectorRegistryPort,
} from '@endora-commerce/contracts';
import { ErpConnectorActivationLock } from './entities/erp-connector-activation-lock.entity.js';
import { ErpConnectorRegistryService } from './services/erp-connector-registry.service.js';

interface ErpConnectorCradle {
  emFactory: () => import('@mikro-orm/postgresql').EntityManager;
}

interface ModuleActivationChangedPayload {
  moduleId?: string;
  active?: boolean;
}

type ErpConnectorModuleId = (typeof ERP_CONNECTOR_MODULES)[number]['id'];

const ERP_MODULE_IDS = new Set<ErpConnectorModuleId>(
  ERP_CONNECTOR_MODULES.map((module) => module.id),
);

function isErpConnectorModuleId(moduleId: string): moduleId is ErpConnectorModuleId {
  return ERP_MODULE_IDS.has(moduleId as ErpConnectorModuleId);
}

function moduleActivationRequest(input: {
  params: unknown;
  body: unknown;
}): { moduleId: string; active: boolean } | null {
  const moduleId =
    input.params !== null && typeof input.params === 'object' && 'id' in input.params
      ? String((input.params as { id: unknown }).id)
      : '';
  const active =
    input.body !== null &&
    typeof input.body === 'object' &&
    'active' in input.body &&
    (input.body as { active: unknown }).active === true;
  if (!moduleId || !active || !isErpConnectorModuleId(moduleId)) return null;
  return { moduleId, active };
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort<ErpConnectorRegistryPort>(
    'erpConnectorRegistryPort',
    ctx
      .asFunction(({ emFactory }: ErpConnectorCradle) => new ErpConnectorRegistryService(emFactory))
      .singleton(),
  );

  /**
   * Feature 119 / FR-006 — mutual exclusion on the operator-activation axis for
   * every `erpConnector: true` module. Owned here (always present) so the check
   * runs while any connector is operator-deactivated — exactly when an activation
   * attempt arrives.
   */
  ctx.interceptors([
    {
      id: 'refuse-when-sibling-erp-active',
      target: 'POST /api/v1/admin/modules/:id/activation',
      phase: 'pre',
      handler: async (interceptorCtx: { params: unknown; body: unknown }): Promise<void> => {
        const request = moduleActivationRequest(interceptorCtx);
        if (!request) return;
        await lazyPort<ErpConnectorRegistryPort>(ctx, 'erpConnectorRegistryPort').assertCanActivate(
          request.moduleId,
        );
      },
    },
  ]);

  ctx.subscribe('module.activation.changed', async (payload) => {
    const event = payload as ModuleActivationChangedPayload;
    if (
      !event.moduleId ||
      typeof event.active !== 'boolean' ||
      !isErpConnectorModuleId(event.moduleId)
    ) {
      return;
    }
    const registry = lazyPort<ErpConnectorRegistryPort>(ctx, 'erpConnectorRegistryPort');
    if (event.active) {
      await registry.recordActive(event.moduleId, null);
    } else {
      await registry.clearActive(event.moduleId);
    }
  });
}

export const entities = [ErpConnectorActivationLock];
