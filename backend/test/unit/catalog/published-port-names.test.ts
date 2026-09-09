import type { EntityManager } from '@mikro-orm/postgresql';
import { afterEach, describe, expect, it } from 'vitest';
import type { CustomFieldDefinitionReadPort } from '@endora-commerce/contracts';
import { EventBus } from '@endora-commerce/platform/events';
import { composeModules } from '../../../src/kernel/compose.js';
import { createRootContainer, registerValues } from '../../../src/kernel/container.js';
import type { KernelContainer } from '../../../src/kernel/container.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import type { ModuleContext } from '../../../src/kernel/index.js';
import { registerModule as registerCatalog } from '../../../../packages/modules/catalog/src/backend/index.js';
import type { CatalogAttributeReadService } from '../../../../packages/modules/catalog/src/backend/services/catalog-attribute-read.service.js';
import {
  presenceAwareBulkRecorder,
  type BulkNotificationPort,
} from '../../../../packages/modules/catalog/src/backend/services/bulk-operation.service.js';

/**
 * Issue #209 — `catalog` resolves the container names its owners *publish*.
 *
 * This is the property `RESOLUTIONS_OF_UNPUBLISHED_NAMES` exists to defend, and
 * the reason it needs defending by something other than the compiler:
 * `lazyPort<T>(ctx, name)` is `new Proxy({} as T, …)`, so `T` is asserted and
 * `name` is a string, and nothing in the language relates the two. A module
 * pointed at the wrong registration type-checks, boots and answers — which is
 * what happened here. Both composition roots handed `custom_fields`' own
 * `CustomFieldDefinitionService` to two different catalog options, so all four
 * of this module's resolutions named `customFieldDefinitionService`: the
 * definition *read* and the transactional *apply* seam were one name with two
 * answers, and the read was served by a CRUD registration handing back live ORM
 * entities where the port's type says records.
 *
 * The assertions are therefore about **which registration answered**, made
 * through the real container with a stub under each name. A test that
 * constructed `CatalogAttributeReadService` itself and passed it a port could
 * not fail — it would be asserting its own wiring.
 *
 * `custom_fields` is `nonDeactivatable`, so that edge has no off state to
 * prove. `admin_notifications` has one, and the last two cases prove the
 * published name is gated exactly as the class registration was: the recorder
 * decides absence in front of the gate and never reaches it (D-60).
 */

/** Never called: nothing here may reach a database. */
const noEm = (): EntityManager => {
  throw new Error('this test must not reach the database');
};

/** An `emFactory` whose only use is "no catalog attribute extension rows". */
const emptyEm = (): EntityManager => ({ find: async () => [] }) as unknown as EntityManager;

const silentLog = { info() {}, warn() {}, error() {} };

/** A definition read port that records the container name it answered under. */
function readPortRecording(name: string, calls: string[]): CustomFieldDefinitionReadPort {
  return {
    listForEntity: async () => {
      calls.push(name);
      return [];
    },
    listForEntityFresh: async () => {
      calls.push(`${name}:fresh`);
      return [];
    },
    getById: async () => {
      calls.push(`${name}:byId`);
      return null;
    },
  };
}

/**
 * `catalog` composed for real, alongside a stand-in for the owner module.
 *
 * The owner is a stub rather than `custom_fields`' own `registerModule` because
 * the point is the *name*: two registrations differing only in what they record
 * make "which one did catalog ask?" observable at all.
 */
function composeCatalogWith(owner: (ctx: ModuleContext) => void): KernelContainer {
  const container = createRootContainer();
  registerValues(container, { emFactory: emptyEm });
  composeModules(
    [
      { id: 'custom_fields', version: '1.0.0', registerModule: owner },
      { id: 'catalog', version: '1.0.0', registerModule: registerCatalog },
    ],
    { container, eventBus: new EventBus(), log: silentLog },
  );
  return container;
}

function composeNotificationsWith(owner: (ctx: ModuleContext) => void): KernelContainer {
  const container = createRootContainer();
  composeModules(
    [{ id: 'admin_notifications', version: '1.0.0', registerModule: owner }],
    { container, eventBus: new EventBus(), log: silentLog },
  );
  return container;
}

afterEach(() => {
  registryCache.__setEnabledForTesting([]);
});

describe('catalog resolves published container names (issue #209)', () => {
  it('reads definitions through the published read port, not the CRUD registration', async () => {
    const calls: string[] = [];
    const container = composeCatalogWith((ctx) => {
      ctx.di.providePort(
        'customFieldDefinitionReadPort',
        ctx
          .asFunction(() => readPortRecording('customFieldDefinitionReadPort', calls))
          .singleton(),
      );
      // The apply seam. `CustomFieldDefinitionService` answers the read shape
      // too — which is exactly why one name could serve both questions and why
      // the wrong one went unnoticed.
      ctx.di.providePort(
        'customFieldDefinitionService',
        ctx
          .asFunction(() => readPortRecording('customFieldDefinitionService', calls))
          .singleton(),
      );
    });
    registryCache.__setEnabledForTesting(['catalog', 'custom_fields']);

    const attributes = container.resolve<CatalogAttributeReadService>('catalogAttributeReadPort');
    await expect(attributes.listAll()).resolves.toEqual([]);

    expect(calls).toEqual(['customFieldDefinitionReadPort']);
  });

  it('records the bulk-operation bell through `adminNotificationRecordPort`', async () => {
    const recorded: string[] = [];
    const container = composeNotificationsWith((ctx) => {
      ctx.di.providePort(
        'adminNotificationRecordPort',
        ctx
          .asFunction(() => ({
            record: async () => {
              recorded.push('adminNotificationRecordPort');
            },
          }))
          .singleton(),
      );
    });
    registryCache.__setEnabledForTesting(['catalog', 'admin_notifications']);

    const recorder = presenceAwareBulkRecorder(
      container.resolve<BulkNotificationPort>('adminNotificationRecordPort'),
    );
    await expect(
      recorder.record({
        audience: 'admin_user',
        targetAdminUserId: '00000000-0000-0000-0000-000000000001',
        kind: 'catalog.bulk_operation.completed',
        title: 'Bulk edit finished',
      }),
    ).resolves.toBe('recorded');
    expect(recorded).toEqual(['adminNotificationRecordPort']);
  });

  it('refuses on the published name when the operator switches `admin_notifications` off', () => {
    const container = composeNotificationsWith((ctx) => {
      ctx.di.providePort(
        'adminNotificationRecordPort',
        ctx.asFunction(() => ({ record: async () => noEm() })).singleton(),
      );
    });
    registryCache.__setEnabledForTesting(['catalog', 'admin_notifications'], {
      deactivated: ['admin_notifications'],
    });

    expect(() => container.resolve('adminNotificationRecordPort')).toThrow(ModuleDisabledError);
  });
});
