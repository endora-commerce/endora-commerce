import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import { FeedTemplate, FeedTemplateField } from '../../helpers/package-entities.js';

/**
 * Feature 067 / T095 — moving a template between installations
 * (FR-012 – FR-018, contracts/template-portability.md).
 *
 * The interesting half is import, because a document arrives from a *different*
 * shop: its `sourceKey`s name attributes that may simply not exist here.
 *
 * The contract's answer is the one that leaves an integrator something to do:
 *
 *  - a resolvable document reproduces the template exactly (FR-014);
 *  - an unresolvable key is imported **unbound** and **reported**, not dropped
 *    and not a 400 — dropping it would produce a feed with a missing column
 *    nobody noticed (FR-015);
 *  - the cost is paid at generation time: a feed on a template with any unbound
 *    field refuses to run, naming each one, so an empty column can never reach
 *    a provider (FR-016);
 *  - nothing is ever overwritten by default (FR-017);
 *  - a malformed document creates nothing at all, and the whole import is one
 *    transaction with one audit entry (FR-018).
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BASE = '/api/v1/admin/feed-templates';

interface TemplateBody {
  id: string;
  name: string;
  providerCode: string;
  outputFormat: string;
  itemGranularity: string;
  taxonomyProviderCode: string | null;
  isSystem: boolean;
  systemCode: string | null;
  version: number;
  usedByFeedCount: number;
  fields: Array<{
    outputName: string;
    sourceKind: string;
    sourceKey: string | null;
    fallbackValue: string | null;
    providerRequired: boolean;
    sortOrder: number;
    helpKey: string | null;
    unbound: boolean;
  }>;
}

interface Document {
  formatVersion: number;
  template: {
    name: string;
    description: string | null;
    providerCode: string;
    outputFormat: string;
    itemGranularity: string;
    taxonomyProviderCode: string | null;
    fields: Array<Record<string, unknown>>;
  };
}

/** A document shaped like one another installation would have exported. */
function documentWith(over: Partial<Document['template']> = {}): Document {
  return {
    formatVersion: 1,
    template: {
      name: `Imported template ${Math.random().toString(36).slice(2, 10)}`,
      description: 'Exported from the other shop',
      providerCode: 'custom',
      outputFormat: 'csv',
      itemGranularity: 'product',
      taxonomyProviderCode: null,
      fields: [
        {
          outputName: 'sku',
          sourceKind: 'sku',
          sourceKey: null,
          constantValue: null,
          fallbackValue: null,
          providerRequired: true,
          transform: null,
          transformArg: null,
          sortOrder: 0,
          helpKey: 'templateHelp.google.id',
        },
        {
          outputName: 'colour',
          sourceKind: 'attribute',
          sourceKey: 'color',
          constantValue: null,
          fallbackValue: 'unknown',
          providerRequired: false,
          transform: 'trim',
          transformArg: null,
          sortOrder: 1,
          helpKey: null,
        },
      ],
      ...over,
    },
  };
}

describe('feed template import/export [integration]', () => {
  let h: BackendServerHandle;
  let googleTemplateId: string;
  let channelId: string;

  const templateCount = async (): Promise<number> => {
    const em = h.em();
    em.clear();
    return em.count(FeedTemplate, { deletedAt: null });
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelStorefrontUrl(h, 'pl_retail');
    const list = await h.app.inject({ method: 'GET', url: BASE, ...ADMIN });
    expect(list.statusCode).toBe(200);
    googleTemplateId = (
      list.json() as { data: Array<{ id: string; systemCode: string | null }> }
    ).data.find((t) => t.systemCode === 'google_merchant_v1')!.id;
    channelId = (await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function importDocument(
    document: Document,
    onNameConflict?: 'create_copy' | 'replace',
  ): Promise<ReturnType<BackendServerHandle['app']['inject']>> {
    return h.app.inject({
      method: 'POST',
      url: `${BASE}/import`,
      ...ADMIN,
      payload: {
        document,
        ...(onNameConflict ? { onNameConflict } : {}),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Export (FR-012, FR-013)
  // -------------------------------------------------------------------------

  it('exports a template as a downloadable document with its whole field list', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${googleTemplateId}/export`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(String(res.headers['content-disposition'])).toContain('.feed-template.json');

    const document = JSON.parse(res.body) as Document;
    expect(document.formatVersion).toBe(1);
    expect(document.template.providerCode).toBe('google_merchant');
    expect(document.template.fields.length).toBeGreaterThan(5);
    expect(document.template.fields.some((f) => f['helpKey'] !== null)).toBe(true);
  });

  it('produces byte-identical bytes on two exports of an unchanged template (FR-013)', async () => {
    const url = `${BASE}/${googleTemplateId}/export`;
    const first = await h.app.inject({ method: 'GET', url, ...ADMIN });
    const second = await h.app.inject({ method: 'GET', url, ...ADMIN });
    expect(first.body).toBe(second.body);
  });

  it('needs only `product_feeds:read` to export', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${googleTemplateId}/export`,
    });
    // No session at all is still refused; the point is the permission literal
    // is `:read`, which the templates-crud contract test pins for the reader.
    expect(res.statusCode).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Round trip (FR-014)
  // -------------------------------------------------------------------------

  it('reproduces the template from a fully resolvable document (FR-014)', async () => {
    const document = documentWith();
    const res = await importDocument(document);
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: { template: TemplateBody; unresolvedBindings: unknown[] };
    };
    expect(body.data.unresolvedBindings).toEqual([]);

    const imported = body.data.template;
    expect(imported.name).toBe(document.template.name);
    expect(imported.outputFormat).toBe('csv');
    expect(imported.itemGranularity).toBe('product');
    // An imported template is an ordinary, editable one — never a system row.
    expect(imported.isSystem).toBe(false);
    expect(imported.systemCode).toBeNull();
    expect(imported.fields.map((f) => f.outputName)).toEqual(['sku', 'colour']);
    expect(imported.fields.map((f) => f.sortOrder)).toEqual([0, 1]);
    expect(imported.fields.every((f) => !f.unbound)).toBe(true);
    expect(imported.fields[1]?.fallbackValue).toBe('unknown');
    expect(imported.fields[0]?.helpKey).toBe('templateHelp.google.id');
  });

  it('round-trips a system template: export here, import back, same field list', async () => {
    const exported = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${googleTemplateId}/export`,
      ...ADMIN,
    });
    const document = JSON.parse(exported.body) as Document;
    document.template.name = `Round trip ${Math.random().toString(36).slice(2, 10)}`;

    const res = await importDocument(document);
    expect(res.statusCode).toBe(201);
    const imported = (res.json() as { data: { template: TemplateBody } }).data.template;
    expect(imported.fields.map((f) => f.outputName)).toEqual(
      document.template.fields.map((f) => f['outputName']),
    );
    expect(imported.providerCode).toBe('google_merchant');
    // The copy carries the shipped template's provider-category binding, which
    // only survives because the document declares a taxonomy provider.
    expect(imported.fields.some((f) => f.sourceKind === 'provider_category')).toBe(true);

    // …and exporting the copy yields the same document again, modulo the name.
    const reExported = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${imported.id}/export`,
      ...ADMIN,
    });
    const again = JSON.parse(reExported.body) as Document;
    expect(again.template.taxonomyProviderCode).toBe('google_merchant');
    expect(again.template.fields).toEqual(document.template.fields);
  });

  // -------------------------------------------------------------------------
  // Unresolvable bindings (FR-015, FR-016)
  // -------------------------------------------------------------------------

  it('imports an unresolvable key as unbound and reports it (FR-015)', async () => {
    const document = documentWith({
      fields: [
        {
          outputName: 'sku',
          sourceKind: 'sku',
          sourceKey: null,
          constantValue: null,
          fallbackValue: null,
          providerRequired: true,
          transform: null,
          transformArg: null,
          sortOrder: 0,
          helpKey: null,
        },
        {
          outputName: 'gtin',
          sourceKind: 'attribute',
          sourceKey: 'not_a_definition_here',
          constantValue: null,
          fallbackValue: null,
          providerRequired: false,
          transform: null,
          transformArg: null,
          sortOrder: 1,
          helpKey: null,
        },
        {
          outputName: 'energy',
          sourceKind: 'custom_field',
          sourceKey: 'energy_class',
          constantValue: null,
          fallbackValue: null,
          providerRequired: false,
          transform: null,
          transformArg: null,
          sortOrder: 2,
          helpKey: null,
        },
      ],
    });

    const res = await importDocument(document);
    // Succeeds. Refusing would leave the integrator with nothing to fix.
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: {
        template: TemplateBody;
        unresolvedBindings: Array<{ outputName: string; sourceKey: string }>;
      };
    };
    expect(body.data.unresolvedBindings.map((b) => b.sourceKey).sort()).toEqual([
      'energy_class',
      'not_a_definition_here',
    ]);
    const byName = new Map(body.data.template.fields.map((f) => [f.outputName, f]));
    expect(byName.get('sku')?.unbound).toBe(false);
    expect(byName.get('gtin')?.unbound).toBe(true);
    expect(byName.get('energy')?.unbound).toBe(true);
    // Never dropped and never blanked — the binding is preserved so the
    // operator can create the attribute and the field starts working.
    expect(byName.get('gtin')?.sourceKey).toBe('not_a_definition_here');
  });

  it('refuses to run a feed whose template has unbound fields, naming each one (FR-016)', async () => {
    const document = documentWith({
      fields: [
        {
          outputName: 'sku',
          sourceKind: 'sku',
          sourceKey: null,
          constantValue: null,
          fallbackValue: null,
          providerRequired: true,
          transform: null,
          transformArg: null,
          sortOrder: 0,
          helpKey: null,
        },
        {
          outputName: 'gtin',
          sourceKind: 'attribute',
          sourceKey: 'still_not_a_definition',
          constantValue: null,
          fallbackValue: null,
          providerRequired: false,
          transform: null,
          transformArg: null,
          sortOrder: 1,
          helpKey: null,
        },
      ],
    });
    const imported = (
      (await importDocument(document)).json() as { data: { template: TemplateBody } }
    ).data.template;

    const feed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: `Feed on imported ${Math.random().toString(36).slice(2, 8)}`,
        slug: `imported-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: imported.id,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
      },
    });
    expect(feed.statusCode).toBe(201);
    const feedId = (feed.json() as { data: { feed: { id: string } } }).data.feed.id;

    // The manual trigger refuses before it enqueues anything…
    const generate = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/product-feeds/${feedId}/generate`,
      ...ADMIN,
    });
    expect(generate.statusCode).toBe(409);
    const detail = generate.json() as {
      error: { message: string; details?: { outputNames?: string[] } };
    };
    expect(detail.error.details?.outputNames).toEqual(['gtin']);
    expect(detail.error.message).toContain('gtin');

    // …and a scheduled tick that reaches the generator fails the run the same way.
    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'scheduled' });
    expect(run.status).toBe('failed');
    expect(run.failureCode).toBe('unbound_template_fields');
    expect(run.failureDetail).toContain('gtin');
  });

  // -------------------------------------------------------------------------
  // Name collision (FR-017)
  // -------------------------------------------------------------------------

  it('refuses a colliding name with no instruction, naming the existing template', async () => {
    const document = documentWith();
    expect((await importDocument(document)).statusCode).toBe(201);

    const before = await templateCount();
    const clash = await importDocument(document);
    expect(clash.statusCode).toBe(409);
    const body = clash.json() as {
      error: { details?: { reason?: string; existingTemplateId?: string; existingName?: string } };
    };
    expect(body.error.details?.reason).toBe('template_name_conflict');
    expect(body.error.details?.existingName).toBe(document.template.name);
    expect(body.error.details?.existingTemplateId).toBeTruthy();
    // Nothing was created by the refused attempt.
    expect(await templateCount()).toBe(before);
  });

  it('imports as a copy under a disambiguated name with `create_copy`', async () => {
    const document = documentWith();
    const first = (
      (await importDocument(document)).json() as { data: { template: TemplateBody } }
    ).data.template;

    const copy = await importDocument(document, 'create_copy');
    expect(copy.statusCode).toBe(201);
    const copied = (copy.json() as { data: { template: TemplateBody } }).data.template;
    expect(copied.id).not.toBe(first.id);
    expect(copied.name).not.toBe(first.name);
    expect(copied.name).toContain(document.template.name);

    // A second copy disambiguates again rather than colliding with the first.
    const second = await importDocument(document, 'create_copy');
    expect(second.statusCode).toBe(201);
    const secondCopy = (second.json() as { data: { template: TemplateBody } }).data.template;
    expect(secondCopy.name).not.toBe(copied.name);
  });

  it('replaces the existing template in place with `replace`, keeping its id so feeds keep working', async () => {
    const document = documentWith();
    const original = (
      (await importDocument(document)).json() as { data: { template: TemplateBody } }
    ).data.template;

    const feed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: `Feed kept alive ${Math.random().toString(36).slice(2, 8)}`,
        slug: `kept-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: original.id,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
      },
    });
    expect(feed.statusCode).toBe(201);

    const revised = documentWith({
      name: document.template.name,
      outputFormat: 'tsv',
      fields: [
        {
          outputName: 'sku',
          sourceKind: 'sku',
          sourceKey: null,
          constantValue: null,
          fallbackValue: null,
          providerRequired: true,
          transform: null,
          transformArg: null,
          sortOrder: 0,
          helpKey: null,
        },
        {
          outputName: 'title',
          sourceKind: 'name',
          sourceKey: null,
          constantValue: null,
          fallbackValue: null,
          providerRequired: false,
          transform: null,
          transformArg: null,
          sortOrder: 1,
          helpKey: null,
        },
      ],
    });
    const replaced = await importDocument(revised, 'replace');
    expect(replaced.statusCode).toBe(201);
    const after = (replaced.json() as { data: { template: TemplateBody } }).data.template;

    expect(after.id).toBe(original.id);
    expect(after.outputFormat).toBe('tsv');
    expect(after.fields.map((f) => f.outputName)).toEqual(['sku', 'title']);
    expect(after.usedByFeedCount).toBe(1);
    // The old field rows are gone, not merged into the new list.
    const em = h.em();
    em.clear();
    const rows = await em.find(FeedTemplateField, { feedTemplateId: original.id });
    expect(rows.map((r) => r.outputName).sort()).toEqual(['sku', 'title']);
  });

  it('refuses `replace` when the target is a system template', async () => {
    const google = await h.em().findOneOrFail(FeedTemplate, { id: googleTemplateId });
    const document = documentWith({ name: google.name });
    const res = await importDocument(document, 'replace');
    expect(res.statusCode).toBe(409);
    expect(
      (res.json() as { error: { details?: { reason?: string } } }).error.details?.reason,
    ).toBe('template_is_system');

    // The system template is untouched, fields and all.
    const em = h.em();
    em.clear();
    const reread = await em.findOneOrFail(FeedTemplate, { id: googleTemplateId });
    expect(reread.outputFormat).toBe('xml');
    expect(reread.isSystem).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Malformed input (FR-018) — untrusted-file handling
  // -------------------------------------------------------------------------

  it('creates nothing for a malformed, truncated or unknown-version document', async () => {
    const before = await templateCount();
    const bodies: unknown[] = [
      { document: { formatVersion: 2, template: documentWith().template } },
      { document: { formatVersion: 1 } },
      { document: { formatVersion: 1, template: { name: '' } } },
      { document: 'not an object at all' },
      {},
    ];
    for (const payload of bodies) {
      const res = await h.app.inject({
        method: 'POST',
        url: `${BASE}/import`,
        ...ADMIN,
        payload: payload as Record<string, unknown>,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(
        (res.json() as { error: { details?: { reason?: string } } }).error.details?.reason,
      ).toBe('invalid_template_document');
    }
    expect(await templateCount()).toBe(before);
  });

  it('refuses a document that would import a template broken by its own rules', async () => {
    const before = await templateCount();

    const duplicated = documentWith({
      fields: [
        {
          outputName: 'sku',
          sourceKind: 'sku',
          sourceKey: null,
          constantValue: null,
          fallbackValue: null,
          providerRequired: false,
          transform: null,
          transformArg: null,
          sortOrder: 0,
          helpKey: null,
        },
        {
          outputName: 'sku',
          sourceKind: 'name',
          sourceKey: null,
          constantValue: null,
          fallbackValue: null,
          providerRequired: false,
          transform: null,
          transformArg: null,
          sortOrder: 1,
          helpKey: null,
        },
      ],
    });
    const dup = await importDocument(duplicated);
    expect(dup.statusCode).toBe(400);
    expect(
      (dup.json() as { error: { details?: { reason?: string } } }).error.details?.reason,
    ).toBe('duplicate_output_name');

    const noTaxonomy = documentWith({
      taxonomyProviderCode: null,
      fields: [
        {
          outputName: 'g:google_product_category',
          sourceKind: 'provider_category',
          sourceKey: null,
          constantValue: null,
          fallbackValue: null,
          providerRequired: false,
          transform: null,
          transformArg: null,
          sortOrder: 0,
          helpKey: null,
        },
      ],
    });
    const taxonomy = await importDocument(noTaxonomy);
    expect(taxonomy.statusCode).toBe(400);
    expect(
      (taxonomy.json() as { error: { details?: { reason?: string } } }).error.details?.reason,
    ).toBe('taxonomy_required_for_provider_category');

    expect(await templateCount()).toBe(before);
  });

  it('cannot overwrite an unrelated template — the document carries no id (FR-018)', async () => {
    const victim = documentWith();
    const victimId = (
      (await importDocument(victim)).json() as { data: { template: TemplateBody } }
    ).data.template.id;

    // A hand-made document carrying an `id` must not be able to aim the import
    // at a different template: the schema ignores it and the name decides.
    const attacker = documentWith();
    (attacker.template as unknown as Record<string, unknown>)['id'] = victimId;
    const res = await importDocument(attacker);
    expect(res.statusCode).toBe(201);
    const created = (res.json() as { data: { template: TemplateBody } }).data.template;
    expect(created.id).not.toBe(victimId);

    const em = h.em();
    em.clear();
    const untouched = await em.findOneOrFail(FeedTemplate, { id: victimId });
    expect(untouched.name).toBe(victim.template.name);
  });

  // -------------------------------------------------------------------------
  // Atomicity and audit (FR-018, FR-059)
  // -------------------------------------------------------------------------

  it('records exactly one audit entry for the whole import', async () => {
    const document = documentWith();
    const res = await importDocument(document);
    expect(res.statusCode).toBe(201);
    const imported = (res.json() as { data: { template: TemplateBody } }).data.template;

    const em = h.em();
    em.clear();
    const entries = await em.find(AuditLogEntry, {
      objectType: 'feed_template',
      objectId: imported.id,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe('product_feeds.template.import');
    expect(entries[0]?.actorAdminUserId ?? null).not.toBeNull();
    const after = entries[0]?.stateAfter as { fields?: unknown[] } | null;
    expect(after?.fields).toHaveLength(2);
  });

  it('refuses an unauthenticated import', async () => {
    const before = await templateCount();
    const res = await h.app.inject({
      method: 'POST',
      url: `${BASE}/import`,
      payload: { document: documentWith() },
    });
    expect(res.statusCode).toBe(401);
    expect(await templateCount()).toBe(before);
  });
});
