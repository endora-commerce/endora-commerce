import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { TRANSACTIONAL_EMAILS_SETTING_CODES } from '../../manifest.js';
import { EmailBlock } from '../entities/email-block.entity.js';
import { EmailTemplate } from '../entities/email-template.entity.js';
import { TransactionalEmail } from '../entities/transactional-email.entity.js';
import { TransactionalEmailContent } from '../entities/transactional-email-content.entity.js';
import type { BrandingService } from './branding.service.js';
import type { ContentResolver } from './content-resolver.js';
import { EmailBlockService } from './email-block.service.js';
import { EmailDefaultsRegistry } from './email-defaults-registry.js';
import { EmailTemplateService } from './email-template.service.js';
import type { EmbedResolver } from './embed-resolver.js';
import { createLogoAssetValidator } from './logo-asset-validator.js';
import { TransactionalEmailService } from './transactional-email.service.js';

/**
 * Issue #1354, the `transactional_emails` half of #544 (owner ruling
 * 2026-10-30, option a) — an e-mail block, template or e-mail body, and the
 * branding logo, are rendered into every message sent. So an asset id a save
 * newly adds is refused unless the caller may see it in the asset library — a
 * hidden file and a missing one alike, with `assets_library`'s own answer. An
 * id the record already stores is accepted as it stands.
 */

const ROW_ID = '11111111-1111-4111-8111-111111111111';
const VISIBLE = '0b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const HIDDEN = '1b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const MISSING = '2b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const STORED = '3b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';

const assets = { visibleToCaller: async (ids: readonly string[]) => new Set(ids.filter((id) => id === VISIBLE)) };

const image = (assetId: string) => ({
  root: { props: {} },
  content: [
    { type: 'transactional_emails.EmailImage', props: { id: 'img-1', imageSource: 'library', src: '', assetId } },
  ],
  zones: {},
});

/** An id under a key that does not end in `assetId` is not an asset reference. */
const notAnEmbed = (value: string) => ({
  root: { props: {} },
  content: [{ type: 'transactional_emails.EmailText', props: { id: 't-1', text: value } }],
  zones: {},
});

interface FakeEm {
  em: EntityManager;
  flushes: () => number;
}

function fakeEm(rows: Map<unknown, unknown>, lists: Map<unknown, unknown[]> = new Map()): FakeEm {
  let flushes = 0;
  const em = {
    findOne: async (entity: unknown) => rows.get(entity) ?? null,
    find: async (entity: unknown) => lists.get(entity) ?? [],
    create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
    flush: async () => {
      flushes += 1;
    },
  };
  return { em: em as unknown as EntityManager, flushes: () => flushes };
}

async function refusal(promise: Promise<unknown>): Promise<HttpError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  return err as HttpError;
}

function expectAssetNotFound(err: HttpError, assetId: string): void {
  expect(err.statusCode).toBe(404);
  expect(err.code).toBe(ERROR_CODES.ASSET_NOT_FOUND);
  expect(err.details).toEqual({ assetId });
}

const storedEnvelope = (assetId: string) => ({ schema_version: 1, languages: { 'en-US': image(assetId) } });

describe.each([
  {
    name: 'EmailBlockService.setContent',
    entity: EmailBlock,
    build: (em: EntityManager, withAssets = true) =>
      new EmailBlockService(() => em, undefined, undefined, withAssets ? assets : undefined),
  },
  {
    name: 'EmailTemplateService.setContent',
    entity: EmailTemplate,
    build: (em: EntityManager, withAssets = true) =>
      new EmailTemplateService(() => em, undefined, undefined, withAssets ? assets : undefined),
  },
])('$name (issue #1354)', ({ entity, build }) => {
  const record = (assetId: string | null) => ({
    id: ROW_ID,
    code: 'promo',
    name: 'Promo',
    description: null,
    isSystem: false,
    active: true,
    languages: ['en-US'],
    version: 1,
    content: assetId ? storedEnvelope(assetId) : { schema_version: 1, languages: {} },
  });

  it.each([HIDDEN, MISSING])('refuses a newly added %s as a missing file, and stores nothing', async (assetId) => {
    const row = record(null);
    const { em, flushes } = fakeEm(new Map([[entity, row]]));
    const err = await refusal(build(em).setContent(ROW_ID, 'en-US', { content: image(assetId), expectedVersion: 1 }));
    expectAssetNotFound(err, assetId);
    expect(flushes()).toBe(0);
    expect(row.version).toBe(1);
  });

  it('stores a file the caller may see', async () => {
    const row = record(null);
    const { em, flushes } = fakeEm(new Map([[entity, row]]));
    await build(em).setContent(ROW_ID, 'en-US', { content: image(VISIBLE), expectedVersion: 1 });
    expect(flushes()).toBe(1);
  });

  it('accepts an id the record already stores, in any language', async () => {
    const row = record(STORED);
    const { em, flushes } = fakeEm(new Map([[entity, row]]));
    await build(em).setContent(ROW_ID, 'pl-PL', { content: image(STORED), expectedVersion: 1 });
    expect(flushes()).toBe(1);
  });

  it('does not ask about a uuid under a key that is not an asset id', async () => {
    const row = record(null);
    const { em, flushes } = fakeEm(new Map([[entity, row]]));
    await build(em).setContent(ROW_ID, 'en-US', { content: notAnEmbed(HIDDEN), expectedVersion: 1 });
    expect(flushes()).toBe(1);
  });

  it('fails closed when the asset read port is not wired', async () => {
    const row = record(null);
    const { em, flushes } = fakeEm(new Map([[entity, row]]));
    await expect(
      build(em, false).setContent(ROW_ID, 'en-US', { content: image(VISIBLE), expectedVersion: 1 }),
    ).rejects.toThrow(/asset read port/);
    expect(flushes()).toBe(0);
  });
});

describe('TransactionalEmailService.saveContent (issue #1354)', () => {
  const email = (defaultAssetId: string | null = null) => ({
    id: ROW_ID,
    code: 'order_confirmation',
    ownerModule: 'orders',
    languages: ['en-US'],
    defaultSubject: { 'en-US': 'Order' },
    defaultContent: defaultAssetId ? storedEnvelope(defaultAssetId) : { schema_version: 1, languages: {} },
    variables: [],
    active: true,
  });

  function serviceOver(
    em: EntityManager,
    withAssets = true,
  ): TransactionalEmailService {
    return new TransactionalEmailService({
      emFactory: () => em,
      contentResolver: {} as unknown as ContentResolver,
      branding: {} as unknown as BrandingService,
      embeds: {} as unknown as EmbedResolver,
      defaults: new EmailDefaultsRegistry(),
      ...(withAssets ? { assets } : {}),
    });
  }

  const save = (service: TransactionalEmailService, assetId: string, salesChannelId: string | null = null) =>
    service.saveContent(
      'order_confirmation',
      { salesChannelId, language: 'en-US' },
      { subject: 'Order', content: image(assetId) as never },
    );

  it.each([HIDDEN, MISSING])('refuses a newly added %s as a missing file, and stores nothing', async (assetId) => {
    const { em, flushes } = fakeEm(new Map<unknown, unknown>([[TransactionalEmail, email()]]));
    expectAssetNotFound(await refusal(save(serviceOver(em), assetId)), assetId);
    expect(flushes()).toBe(0);
  });

  it('stores a file the caller may see', async () => {
    const { em, flushes } = fakeEm(new Map<unknown, unknown>([[TransactionalEmail, email()]]));
    await save(serviceOver(em), VISIBLE);
    expect(flushes()).toBe(1);
  });

  it('accepts an id any of the e-mail’s stored bodies already holds', async () => {
    const stored = { emailId: ROW_ID, salesChannelId: null, language: 'en-US', content: image(STORED), version: 1 };
    const { em, flushes } = fakeEm(
      new Map<unknown, unknown>([[TransactionalEmail, email()]]),
      new Map([[TransactionalEmailContent, [stored]]]),
    );
    // A channel override started from the platform-wide body keeps its image.
    await save(serviceOver(em), STORED, '44444444-4444-4444-8444-444444444444');
    expect(flushes()).toBe(1);
  });

  it('accepts an id the e-mail’s default content holds', async () => {
    const { em, flushes } = fakeEm(new Map<unknown, unknown>([[TransactionalEmail, email(STORED)]]));
    await save(serviceOver(em), STORED);
    expect(flushes()).toBe(1);
  });

  it('fails closed when the asset read port is not wired', async () => {
    const { em, flushes } = fakeEm(new Map<unknown, unknown>([[TransactionalEmail, email()]]));
    await expect(save(serviceOver(em, false), VISIBLE)).rejects.toThrow(/asset read port/);
    expect(flushes()).toBe(0);
  });
});

describe('transactional_emails.logo_asset_id write validator (issue #1354)', () => {
  const validator = createLogoAssetValidator(assets);
  const input = (proposedValue: unknown, currentValues: unknown[] = ['']) => ({
    code: TRANSACTIONAL_EMAILS_SETTING_CODES.LOGO_ASSET_ID,
    ownerModuleId: 'transactional_emails',
    proposedValue,
    currentValues,
    projection: [],
    targetedChannelIds: [],
  });

  it('answers for the logo setting, contributed by transactional_emails', () => {
    expect(validator.codes).toEqual([TRANSACTIONAL_EMAILS_SETTING_CODES.LOGO_ASSET_ID]);
    expect(validator.contributorModuleId).toBe('transactional_emails');
  });

  it.each([HIDDEN, MISSING])('refuses %s as a missing file', async (assetId) => {
    const err = await refusal(validator.validate(input(assetId)));
    expectAssetNotFound(err, assetId);
  });

  it('accepts a visible logo, an unset one, and the logo already stored', async () => {
    await expect(validator.validate(input(VISIBLE))).resolves.toBeUndefined();
    await expect(validator.validate(input(''))).resolves.toBeUndefined();
    await expect(validator.validate(input(HIDDEN, ['', HIDDEN]))).resolves.toBeUndefined();
  });
});
