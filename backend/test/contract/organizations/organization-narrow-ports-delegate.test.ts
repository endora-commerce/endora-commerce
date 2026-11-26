import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  type OrganizationCommandPort,
  type OrganizationCustomFieldWritePort,
  type OrganizationDetailsPort,
  type OrganizationWritePort,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import { expectPortParity, observeWrite, type ParityObservation } from '../../helpers/aggregate-port-parity.js';

/**
 * `specs/186-aggregate-ports/` T025, T031 (issue #1821) — the two narrow ports
 * the Organization aggregate port deprecates in 0.113.0 delegate to it, so a
 * consumer that has not moved yet sees exactly what it saw before: the same
 * entries (action, object type, state shape), the same refusal codes, the same
 * answers. Measured for every deprecated method, under a worker's system scope:
 *
 * - `organizationWritePort.create` / `.update` against
 *   `organizationCommandPort.create` / `.update` (the update case is also
 *   `organization-command-port.test.ts`'s parity for `update`);
 * - `organizationWritePort.findByTaxId` against `organizationDetailsPort.findByTaxId`;
 * - `organizationCustomFieldWritePort.setCustomFieldValues` against the port's,
 *   its `extensions` passed through.
 */

describe('the deprecated Organization write ports delegate (#1821)', () => {
  let h: BackendServerHandle;
  let channel: string;
  const stamp = Date.now().toString().slice(-8);
  let seq = 0;
  const taxId = (): string => `PL186D${stamp}${(seq++).toString().padStart(3, '0')}`;

  const asWorker = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('test: a connector on the deprecated ports', fn);
  const port = () => h.container.resolve<OrganizationCommandPort>('organizationCommandPort');
  const writePort = () => h.container.resolve<OrganizationWritePort>('organizationWritePort');
  const customFieldPort = () => h.container.resolve<OrganizationCustomFieldWritePort>('organizationCustomFieldWritePort');

  const observe = <T>(objectId: string | ((result: T) => string), write: () => Promise<T>): Promise<ParityObservation> =>
    observeWrite<T>({ em: () => h.em().fork(), objectType: 'organization', objectId }, write).then(({ observation }) => observation);

  const input = () => ({
    name: `Delegated ${stamp} ${seq}`,
    taxId: taxId(),
    registeredAddress: { street: 'ul. Stara 1', city: 'Łódź', postalCode: '90-001', country: 'PL' },
    salesChannelIds: [channel] as [string],
    status: 'active' as const,
  });

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string; details: unknown }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string; details?: unknown };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error), details: e.details };
    }
    throw new Error('expected a refusal');
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em().fork();
    const sales = em.create(SalesChannel, {
      code: `delegate-${stamp}`,
      name: { en: 'delegate' },
      defaultLanguage: 'en',
      languages: ['en'],
      defaultCurrency: 'PLN',
      currencies: ['PLN'],
    });
    await em.persist(sales).flush();
    channel = sales.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('organizationWritePort.create writes what organizationCommandPort.create writes', async () => {
    await expectPortParity({
      viaRoute: () => observe((record) => record.id, () => asWorker(() => writePort().create(input()))),
      viaPort: () => observe((record) => record.id, () => asWorker(() => port().create(input()))),
    });
  });

  it('organizationWritePort.update writes what organizationCommandPort.update writes, version included', async () => {
    const em = h.em().fork();
    const [a, b] = [await seedAdHocOrganization(em, `Delegate A ${stamp}`), await seedAdHocOrganization(em, `Delegate B ${stamp}`)];
    await expectPortParity({
      viaRoute: () => observe(a.id, () => asWorker(() => writePort().update(a.id, { legalName: 'A sp. z o.o.' }, { expectedVersion: a.version }))),
      viaPort: () => observe(b.id, () => asWorker(() => port().update(b.id, { legalName: 'B sp. z o.o.' }, { expectedVersion: b.version }))),
    });
    for (const write of [
      () => writePort().update(a.id, { name: 'Stale' }, { expectedVersion: 0 }),
      () => port().update(b.id, { name: 'Stale' }, { expectedVersion: 0 }),
    ]) {
      expect(await refusal(asWorker(write))).toMatchObject({ statusCode: 409, code: ERROR_CODES.VERSION_CONFLICT });
    }
  });

  it('answers the refusals it always answered', async () => {
    const unknown = randomUUID();
    for (const create of [writePort().create.bind(writePort()), port().create.bind(port())]) {
      expect(await refusal(asWorker(() => create({ ...input(), salesChannelIds: [unknown] })))).toMatchObject({
        statusCode: 422,
        code: ERROR_CODES.UNKNOWN_SALES_CHANNEL,
      });
      expect(await refusal(asWorker(() => create({ ...input(), name: '' })))).toMatchObject({
        statusCode: 422,
        code: ERROR_CODES.VALIDATION_FAILED,
      });
    }
    // The narrow port's own strict patch and option shape.
    const org = await seedAdHocOrganization(h.em().fork(), `Delegate strict ${stamp}`);
    expect(
      await refusal(asWorker(() => writePort().update(org.id, { taxId: 'PL0000000000' } as never))),
    ).toMatchObject({ statusCode: 422, code: ERROR_CODES.VALIDATION_FAILED });
    expect(
      await refusal(asWorker(() => writePort().update(org.id, {}, { expectedVersion: -1 }))),
    ).toMatchObject({ statusCode: 422, code: ERROR_CODES.VALIDATION_FAILED });
  });

  it('organizationWritePort.findByTaxId answers what organizationDetailsPort.findByTaxId answers', async () => {
    const org = await seedAdHocOrganization(h.em().fork(), `Delegate lookup ${stamp}`);
    const details = h.container.resolve<OrganizationDetailsPort>('organizationDetailsPort');
    const viaNarrow = await asWorker(() => writePort().findByTaxId(org.taxId!));
    expect(viaNarrow.map((r) => r.id)).toEqual([org.id]);
    expect(viaNarrow).toEqual(await asWorker(() => details.findByTaxId(org.taxId!)));
  });

  it('organizationCustomFieldWritePort.setCustomFieldValues writes what the port writes, and passes extensions on', async () => {
    const em = h.em().fork();
    const [a, b] = [await seedAdHocOrganization(em, `Delegate CF A ${stamp}`), await seedAdHocOrganization(em, `Delegate CF B ${stamp}`)];
    const merge = async (current: Record<string, unknown>) => ({ ...current, delegated: 'yes' });
    await expectPortParity({
      viaRoute: () => observe(a.id, () => asWorker(() => customFieldPort().setCustomFieldValues(a.id, merge))),
      viaPort: () => observe(b.id, () => asWorker(() => port().setCustomFieldValues(b.id, merge))),
    });
    let merged = false;
    expect(
      await refusal(
        asWorker(() =>
          customFieldPort().setCustomFieldValues(
            a.id,
            async (current) => {
              merged = true;
              return current;
            },
            { extensions: { nobody_claims_this: {} } },
          ),
        ),
      ),
    ).toMatchObject({ statusCode: 422, code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED });
    expect(merged).toBe(false);
  });
});
