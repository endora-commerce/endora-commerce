import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isHostReferenceProperty, type MergeDeclarationWithModule, type MergePopulationEntity } from '@endora-commerce/contracts';
import {
  checkMergeParticipation,
  declarationsFrom,
  entityTablesFromSource,
  persistedEntitiesFromSource,
  referenceWriteFindings,
} from '../../../scripts/check-merge-participation.js';
import { MERGE_PARTICIPATION_PENDING } from '../../../scripts/ledgers/merge-participation-pending.js';

/**
 * `check:merge-participation` (`specs/192-organization-merge/` FR-045, SC-008,
 * `contracts/merge-participation-check.md` §2) — one red proof per finding and
 * the green twin of each, the source reader the population comes from, and the
 * real tree's run with its read line.
 */

const ORDER_SOURCE = `
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { OrgScoped } from '@endora-commerce/platform/tenancy';

@OrgScoped()
@Entity({ tableName: 'orders' })
export class Order {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  organizationId!: string;

  @Property({ type: 'uuid', nullable: true })
  payerOrganizationId?: string | null;

  /** Not persisted: no decorator. */
  scratchOrganizationId?: string;
}

export class NotAnEntity {
  organizationId!: string;
}
`;

const population: MergePopulationEntity[] = [
  { moduleId: 'orders', entity: 'Order', properties: ['id', 'organizationId', 'payerOrganizationId'] },
  { moduleId: 'carts', entity: 'Cart', properties: ['id', 'organizationId', 'scope', 'scopeId'] },
];

const orders = (references: MergeDeclarationWithModule['references'], key = 'orders'): MergeDeclarationWithModule => ({
  moduleId: 'orders',
  host: 'organization',
  key,
  phase: 'records',
  references,
});
const carts: MergeDeclarationWithModule = {
  moduleId: 'carts',
  host: 'organization',
  key: 'carts',
  phase: 'records',
  references: [{ entity: 'Cart', property: 'organizationId', disposition: 're_point' }],
};
const ordersComplete = orders([
  { entity: 'Order', property: 'organizationId', disposition: 're_point' },
  { entity: 'Order', property: 'payerOrganizationId', disposition: 're_point' },
]);

const kinds = (declarations: MergeDeclarationWithModule[], pending = [] as { moduleId: string; entity: string; property: string }[]) =>
  checkMergeParticipation({ population, declarations, pending }).findings.map((f) => `${f.kind}:${f.entity}.${f.property}`);

describe('persistedEntitiesFromSource', () => {
  it('reads every @Entity class and only its decorated properties', () => {
    expect(persistedEntitiesFromSource(ORDER_SOURCE, 'order.entity.ts')).toEqual([
      { entity: 'Order', properties: ['id', 'organizationId', 'payerOrganizationId'] },
    ]);
  });
});

describe('the findings — one red proof each, and its green twin', () => {
  it('green: every reference declared by its own module', () => {
    expect(kinds([ordersComplete, carts])).toEqual([]);
  });

  it('undeclared-reference', () => {
    expect(kinds([orders([{ entity: 'Order', property: 'organizationId', disposition: 're_point' }]), carts])).toEqual([
      'undeclared-reference:Order.payerOrganizationId',
    ]);
  });

  it('declared-missing-property (an absent property, and an absent polymorphic discriminator)', () => {
    expect(
      kinds([
        orders([
          { entity: 'Order', property: 'organizationId', disposition: 're_point' },
          { entity: 'Order', property: 'payerOrganizationId', disposition: 're_point' },
          { entity: 'Order', property: 'ghostOrganizationId', disposition: 're_point' },
        ]),
        {
          ...carts,
          references: [
            ...carts.references,
            { entity: 'Cart', property: 'scopeId', polymorphic: { discriminator: 'kind', value: 'organization' }, disposition: 'sum' },
          ],
        },
      ]),
    ).toEqual(['declared-missing-property:Cart.kind', 'declared-missing-property:Order.ghostOrganizationId']);
    // Green: the discriminator exists.
    expect(
      kinds([
        ordersComplete,
        {
          ...carts,
          references: [
            ...carts.references,
            { entity: 'Cart', property: 'scopeId', polymorphic: { discriminator: 'scope', value: 'organization' }, disposition: 'sum' },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it('foreign-declaration', () => {
    expect(
      kinds([
        orders([
          { entity: 'Order', property: 'organizationId', disposition: 're_point' },
          { entity: 'Order', property: 'payerOrganizationId', disposition: 're_point' },
          { entity: 'Cart', property: 'organizationId', disposition: 're_point' },
        ]),
        carts,
      ]),
    ).toEqual(['foreign-declaration:Cart.organizationId']);
  });

  it('double-coverage', () => {
    expect(
      kinds([ordersComplete, orders([{ entity: 'Order', property: 'organizationId', disposition: 're_point' }], 'second'), carts]),
    ).toEqual(['double-coverage:Order.organizationId']);
  });

  it('stale-pending (the reference is now declared, or gone), and its green twin', () => {
    expect(
      kinds([ordersComplete, carts], [
        { moduleId: 'orders', entity: 'Order', property: 'organizationId' },
        { moduleId: 'orders', entity: 'Gone', property: 'organizationId' },
      ]),
    ).toEqual(['stale-pending:Gone.organizationId', 'stale-pending:Order.organizationId']);
    expect(
      kinds([orders([{ entity: 'Order', property: 'organizationId', disposition: 're_point' }]), carts], [
        { moduleId: 'orders', entity: 'Order', property: 'payerOrganizationId' },
      ]),
    ).toEqual([]);
  });
});

// FR-047 — a write that sets a declared reference outside an ORM flush is
// invisible to the platform's flush guard: the participation declares
// `freeze: 'guarded'` and the file asks `assertMergeWritable` first.
describe('unguarded-reference-write', () => {
  const tables = entityTablesFromSource(ORDER_SOURCE, 'order.entity.ts').map((table) => ({ moduleId: 'orders', ...table }));
  const run = (text: string, declaration: MergeDeclarationWithModule = ordersComplete, file = 'packages/modules/orders/src/backend/services/order-service.ts') =>
    referenceWriteFindings({ tables, declarations: [declaration], files: [{ file, moduleId: 'orders', text }] }).map(
      (finding) => `${finding.kind}:${finding.entity}.${finding.property}:${finding.line}`,
    );
  const insert = "await em.execute(`insert into \"orders\" (\"id\", \"organization_id\") values (?, ?)`, [id, org]);";
  const setInUpdate = 'await em.execute(`update "orders" set "payer_organization_id" = ? where "id" = ?`, [org, id]);';
  const filterInUpdate = 'await em.execute(`update "orders" set "status" = ? where "organization_id" = ?`, [s, org]);';
  const nativeSets = 'await em.nativeUpdate(Order, { id }, { organizationId: org });';
  const nativeFilters = 'await em.nativeUpdate(Order, { organizationId: org }, { status: "x" });';

  it('reads each entity’s table and the columns of its persisted properties', () => {
    expect(entityTablesFromSource(ORDER_SOURCE, 'order.entity.ts')).toEqual([
      {
        entity: 'Order',
        table: 'orders',
        columns: { id: 'id', organizationId: 'organization_id', payerOrganizationId: 'payer_organization_id' },
      },
    ]);
  });

  it('red: an insert, an update’s SET and a native call that set a reference', () => {
    expect(run(insert)).toEqual(['unguarded-reference-write:Order.organizationId:1']);
    expect(run(setInUpdate)).toEqual(['unguarded-reference-write:Order.payerOrganizationId:1']);
    expect(run(nativeSets)).toEqual(['unguarded-reference-write:Order.organizationId:1']);
  });

  it('green: a statement or a native call that only filters by it', () => {
    expect(run(filterInUpdate)).toEqual([]);
    expect(run(nativeFilters)).toEqual([]);
  });

  it('red until both: the participation declares guarded and the file asks assertMergeWritable', () => {
    const guarded = { ...ordersComplete, freeze: 'guarded' as const };
    expect(run(insert, guarded)).toEqual(['unguarded-reference-write:Order.organizationId:1']);
    expect(run(`assertMergeWritable('organization', org);\n${insert}`, ordersComplete)).toEqual([
      'unguarded-reference-write:Order.organizationId:2',
    ]);
    expect(run(`assertMergeWritable('organization', org);\n${insert}`, guarded)).toEqual([]);
  });

  it('green: the merge’s own commands, and a kept reference', () => {
    expect(run(insert, ordersComplete, 'packages/modules/orders/src/backend/commands/order-merge-reassign.command.ts')).toEqual([]);
    expect(run(insert, orders([{ entity: 'Order', property: 'organizationId', disposition: 'kept' }]))).toEqual([]);
  });
});

describe('the declarations it reads', () => {
  it('takes every manifest participation with its module id, and the kernel’s own', () => {
    const declarations = declarationsFrom([
      {
        id: 'orders',
        merge: { participates: [{ host: 'organization', key: 'orders', phase: 'records', references: ordersComplete.references }] },
      } as never,
    ]);
    expect(declarations.map((d) => `${d.moduleId}/${d.key}`)).toEqual(['orders/orders', 'core/kernel-logs']);
  });
});

describe('the pending ledger', () => {
  it('names the task that removes each entry, and holds no module twice for one property', () => {
    const keys = MERGE_PARTICIPATION_PENDING.map((entry) => `${entry.moduleId}:${entry.entity}.${entry.property}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of MERGE_PARTICIPATION_PENDING) expect(entry.removedBy).toMatch(/^T\d{3}$/);
  });

  it('holds no Organization reference: every Organization participant is delivered, so a start is accepted (T073)', () => {
    expect(
      MERGE_PARTICIPATION_PENDING.filter((entry) => isHostReferenceProperty('organization', entry.moduleId, entry.property)),
    ).toEqual([]);
  });
});

describe('the real tree', () => {
  it('runs clean and prints its read line', () => {
    const backend = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const result = spawnSync('pnpm', ['exec', 'tsx', 'scripts/check-merge-participation.ts'], {
      cwd: backend,
      encoding: 'utf8',
    });
    expect(`${result.stdout}${result.stderr}`).toMatch(
      /\[merge-participation\] read: files=\d+ sites=\d+ sources=manifest-index:(\d+)\/\1/,
    );
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  }, 300_000);
});
