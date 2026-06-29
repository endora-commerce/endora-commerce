import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Seeds a predefined **CMS block** `newsletter_consent` (feature 048) that the
 * storefront registration page renders as the newsletter-consent checkbox
 * label. The block links to the Privacy Policy CMS page (`/privacy-policy`).
 *
 * CMS blocks resolve per sales channel (they require a channel binding), and the
 * system default channel is created at boot (not via migration), so this runs as
 * an idempotent boot-time seeder — it inserts the block once and binds it to any
 * channel that is not yet bound. It writes the CMS module's tables directly as a
 * convenience seed; it is guarded so a platform without the CMS module installed
 * simply skips it.
 */
export const NEWSLETTER_CONSENT_BLOCK_CODE = 'newsletter_consent';

const LANGUAGES = ['en-US', 'pl-PL'];

function tree(html: string): Record<string, unknown> {
  return {
    root: { props: {} },
    content: [{ type: 'Text', props: { id: 'consent', tiptapContent: null, html } }],
    zones: {},
  };
}

const CONTENT_ENVELOPE = {
  schema_version: 1,
  languages: {
    'en-US': tree(
      '<p>Yes, I would like to receive the newsletter and marketing emails. ' +
        'I have read the <a href="/privacy-policy">Privacy Policy</a>.</p>',
    ),
    'pl-PL': tree(
      '<p>Tak, chcę otrzymywać newsletter i wiadomości marketingowe. ' +
        'Zapoznałem(-am) się z <a href="/privacy-policy">Polityką prywatności</a>.</p>',
    ),
  },
};

export async function ensureNewsletterConsentBlock(emFactory: () => EntityManager): Promise<void> {
  const conn = emFactory().getConnection();
  const code = NEWSLETTER_CONSENT_BLOCK_CODE;

  await conn.execute(
    `insert into cms_blocks (id, name, code, active, description, content, languages, version, created_at, updated_at)
     select ?, 'Newsletter consent', ?, true, null, ?::jsonb, ?::jsonb, 1, now(), now()
     where not exists (select 1 from cms_blocks where code = ?)`,
    [randomUUID(), code, JSON.stringify(CONTENT_ENVELOPE), JSON.stringify(LANGUAGES), code],
  );

  const rows = (await conn.execute(`select id from cms_blocks where code = ? limit 1`, [code])) as Array<{
    id: string;
  }>;
  const blockId = rows[0]?.id;
  if (!blockId) return;

  await conn.execute(
    `insert into cms_block_sales_channels (block_id, sales_channel_id, code)
     select ?, sc.id, ? from sales_channels sc
     where not exists (
       select 1 from cms_block_sales_channels c where c.sales_channel_id = sc.id and c.code = ?
     )`,
    [blockId, code, code],
  );
}
