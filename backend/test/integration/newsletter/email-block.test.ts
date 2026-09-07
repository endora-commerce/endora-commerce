import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { NewsletterEmailBlockService } from '../../../../packages/modules/newsletter/src/backend/services/email-block.service.js';
import { NewsletterEmailBlock } from '../../helpers/package-entities.js';

function tree(text: string): Record<string, unknown> {
  return { root: { props: {} }, content: [{ type: 'transactional_emails.EmailText', props: { id: 't', text } }], zones: {} };
}

describe('newsletter email blocks (US5)', () => {
  let db: TestDb;
  let svc: NewsletterEmailBlockService;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
    svc = new NewsletterEmailBlockService(() => db.em());
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  it('creates, rejects duplicate code, and enforces version on update', async () => {
    const block = await svc.create({ code: 'promo_footer', name: 'Promo footer', content: tree('Footer v1') });
    expect(block.code).toBe('promo_footer');
    expect(block.version).toBe(1);
    await expect(svc.create({ code: 'promo_footer', name: 'Dup', content: tree('x') })).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(
      svc.update(block.id, { content: tree('v2'), expectedVersion: 99 }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses to delete a seeded system block', async () => {
    const system = await db.em().findOneOrFail(NewsletterEmailBlock, { isSystem: true });
    await expect(svc.remove(system.id)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('exposes active blocks as renderer embeds and reflects edits', async () => {
    const block = await svc.create({ code: 'hdr', name: 'Header', content: tree('Header v1') });

    const embeds1 = await svc.resolveEmbeds('en-US');
    expect(embeds1.blocks['hdr']).toBeDefined();

    await svc.update(block.id, { content: tree('Header v2'), expectedVersion: 1 });
    const embeds2 = await svc.resolveEmbeds('en-US');
    expect(JSON.stringify(embeds2.blocks['hdr'])).toContain('Header v2');
  });
});
