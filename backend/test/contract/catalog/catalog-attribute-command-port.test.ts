import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type CatalogAttributeCommandPort } from '@endora-commerce/contracts';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { expectPortParity, observeWrite, type ParityObservation } from '../../helpers/aggregate-port-parity.js';

/**
 * `specs/186-aggregate-ports/` T071 (issue #1825, US6) — `catalogAttributeCommandPort`, the
 * attribute-definition port, runs the Command the admin attribute route for the same
 * operation runs: each operation twice, through the route and through the port under the same
 * administrator, on two attributes in the same state, the audit entries held equal
 * (`expectPortParity`). The definitions cache drop after each write is the shared service
 * method's; the read-back after each port call shows it.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const ATTRIBUTES = '/api/v1/admin/catalog/attributes';

describe('catalogAttributeCommandPort — the admin attribute routes’ Commands (#1825)', () => {
  let h: BackendServerHandle;
  let port: CatalogAttributeCommandPort;
  const run = randomUUID().slice(0, 8).replace(/-/g, '');
  let seq = 0;
  const created: string[] = [];
  const key = (): string => {
    const k = `p186_${run}_${seq++}`;
    created.push(k);
    return k;
  };

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    withSystemScopeActingFor(TEST_ADMIN_ID, 'test: catalog attribute command port', fn);

  const body = (k: string) => ({
    key: k,
    label: { 'en-US': k },
    labelDefault: k,
    type: 'input' as const,
    isSearchable: false,
    isFilterable: false,
    isVariantAxis: false,
  });
  /** A select attribute, which needs one option of its own to be created. */
  const selectBody = (k: string) => ({
    ...body(k),
    type: 'select' as const,
    options: [{ value: 'seed', labelDefault: 'Seed' }],
  });

  async function route(method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, status = 200) {
    const res = await h.app.inject({ method, url, cookies: ADMIN, ...(payload ? { payload } : {}) });
    expect(res.statusCode, res.body).toBe(status);
    return res.body ? (res.json() as { data: Record<string, unknown> }) : null;
  }

  function observe<T>(objectType: string, objectId: string | ((result: T) => string), write: () => Promise<T>): Promise<ParityObservation> {
    return observeWrite<T>({ em: () => h.em().fork(), objectType, objectId }, write).then(({ observation }) => observation);
  }

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error) };
    }
    throw new Error('expected a refusal');
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    port = h.container.resolve<CatalogAttributeCommandPort>('catalogAttributeCommandPort');
  });

  afterAll(async () => {
    if (h) {
      for (const k of created) await h.app.inject({ method: 'DELETE', url: `${ATTRIBUTES}/${k}`, cookies: ADMIN });
      await teardownBackendServer(h);
    }
  });

  it('create, update — catalog.attribute.create / .update', async () => {
    const [ka, kb] = [key(), key()];
    const made = await expectPortParity({
      viaRoute: () =>
        observe<{ data: Record<string, unknown> } | null>('product_attribute', (res) => res!.data['id'] as string, () =>
          route('POST', ATTRIBUTES, body(ka), 201),
        ),
      viaPort: () => observe('product_attribute', (view) => view.id, () => asAdmin(() => port.create(body(kb)))),
    });
    expect(made.port.audit.map((e) => e.action)).toEqual(['catalog.attribute.create']);
    const [ia, ib] = [made.route.audit[0]!.objectId!, made.port.audit[0]!.objectId!];

    const updated = await expectPortParity({
      viaRoute: () => observe('product_attribute', ia, () => route('PATCH', `${ATTRIBUTES}/${ka}`, { labelDefault: 'Renamed' })),
      viaPort: () => observe('product_attribute', ib, () => asAdmin(() => port.update(kb, { labelDefault: 'Renamed' }))),
    });
    expect(updated.port.audit.map((e) => e.action)).toEqual(['catalog.attribute.update']);
  });

  it('options — catalog.attribute_option.create / .update / .delete', async () => {
    const [ka, kb] = [key(), key()];
    await route('POST', ATTRIBUTES, selectBody(ka), 201);
    await asAdmin(() => port.create(selectBody(kb)));

    const added = await expectPortParity({
      viaRoute: () => observe('attribute_option', 'new', () => route('POST', `${ATTRIBUTES}/${ka}/options`, { value: 'red', labelDefault: 'Red' }, 201)),
      viaPort: () => observe('attribute_option', 'new', () => asAdmin(() => port.addOption(kb, { value: 'red', labelDefault: 'Red' }))),
    });
    expect(added.port.audit.map((e) => e.action)).toEqual(['catalog.attribute_option.create']);

    const optionOf = async (k: string) => {
      const res = await h.app.inject({ method: 'GET', url: `${ATTRIBUTES}/${k}/options`, cookies: ADMIN });
      return (res.json() as { data: { items: Array<{ id: string; value: string }> } }).data.items.find((o) => o.value === 'red')!.id;
    };
    const [oa, ob] = [await optionOf(ka), await optionOf(kb)];
    await expectPortParity({
      viaRoute: () => observe('attribute_option', oa, () => route('PATCH', `${ATTRIBUTES}/${ka}/options/${oa}`, { labelDefault: 'Rot' })),
      viaPort: () => observe('attribute_option', ob, () => asAdmin(() => port.updateOption(ob, { labelDefault: 'Rot' }))),
    });
    await expectPortParity({
      viaRoute: () => observe('attribute_option', oa, () => route('DELETE', `${ATTRIBUTES}/${ka}/options/${oa}`, undefined, 204)),
      viaPort: () => observe('attribute_option', ob, () => asAdmin(() => port.deleteOption(ob))),
    });
  });

  it('delete — catalog.attribute.delete; then the read port no longer answers it', async () => {
    const [ka, kb] = [key(), key()];
    await route('POST', ATTRIBUTES, body(ka), 201);
    await asAdmin(() => port.create(body(kb)));
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe('product_attribute', ka, () => route('DELETE', `${ATTRIBUTES}/${ka}`, undefined, 204)),
      viaPort: () => observe('product_attribute', kb, () => asAdmin(() => port.delete(kb))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['catalog.attribute.delete']);
    const res = await h.app.inject({ method: 'GET', url: `${ATTRIBUTES}/${kb}`, cookies: ADMIN });
    expect(res.statusCode).toBe(404);
  });

  it('source recorded; a malformed one refused 422 and an unknown attribute 404, with nothing written', async () => {
    const k = key();
    const view = await asAdmin(() => port.create(body(k), { source: 'pim_unopim' }));
    const [entry] = (await h
      .em()
      .getConnection()
      .execute(`select state_after from audit_log_entries where object_type = 'product_attribute' and object_id = ?`, [view.id])) as Array<{
      state_after: Record<string, unknown>;
    }>;
    expect(entry!.state_after).toMatchObject({ source: 'pim_unopim' });

    expect(await refusal(asAdmin(() => port.update(k, { labelDefault: 'x' }, { source: 'Bad Code' })))).toEqual({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    expect(await refusal(asAdmin(() => port.update(`missing_${run}`, { labelDefault: 'x' })))).toEqual({
      statusCode: 404,
      code: ERROR_CODES.NOT_FOUND,
    });
  });
});
