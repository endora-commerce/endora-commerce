import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Seeds a predefined **CMS block** `cookieconsent.message` (feature 049) that the
 * storefront cookie-consent banner renders as its message text. CMS blocks
 * resolve per sales channel (they require a channel binding), and the system
 * default channel is created at boot (not via migration), so this runs as an
 * idempotent boot-time seeder — it inserts the block once and binds it to any
 * channel not yet bound. It writes the CMS module's tables directly as a seed
 * convenience and is guarded so a platform without the CMS module simply skips it.
 */
export const COOKIE_CONSENT_BLOCK_CODE = 'cookieconsent.message';

const LANGUAGES = ['en-US', 'pl-PL'];

function tree(html: string): Record<string, unknown> {
  return {
    root: { props: {} },
    content: [{ type: 'Text', props: { id: 'cookieconsent', tiptapContent: null, html } }],
    zones: {},
  };
}

const CONTENT_ENVELOPE = {
  schema_version: 1,
  languages: {
    'en-US': tree(
      '<p>We use cookies for analytics (Google Analytics). You can accept or reject ' +
        'statistics. See our <a href="/privacy-policy">Privacy Policy</a>.</p>',
    ),
    'pl-PL': tree(
      '<p>Używamy plików cookie do analityki (Google Analytics). Możesz zaakceptować lub ' +
        'odrzucić statystyki. Zobacz naszą <a href="/privacy-policy">Politykę prywatności</a>.</p>',
    ),
  },
};

export async function ensureCookieConsentBlock(emFactory: () => EntityManager): Promise<void> {
  const conn = emFactory().getConnection();
  const code = COOKIE_CONSENT_BLOCK_CODE;

  await conn.execute(
    `insert into cms_blocks (id, name, code, active, description, content, languages, version, created_at, updated_at)
     select ?, 'Cookie consent message', ?, true, null, ?::jsonb, ?::jsonb, 1, now(), now()
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
