import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';

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
  /**
   * `em.execute`, not `em.getConnection().execute` (issue #200). A connection
   * is not a transaction: the statements below used to take their own pooled
   * connection and commit immediately, so a caller holding a transaction open
   * could neither roll them back nor have them see its own uncommitted rows —
   * a channel created in that transaction was invisible here, and binding it
   * failed on `cms_block_sales_channels_channel_fk`. Identical outside a
   * transaction, which is where the boot hook that calls this normally runs.
   */
  const em = emFactory();
  const code = COOKIE_CONSENT_BLOCK_CODE;

  await em.execute(
    `insert into cms_blocks (id, name, code, active, description, content, languages, version, created_at, updated_at)
     select ?, 'Cookie consent message', ?, true, null, ?::jsonb, ?::jsonb, 1, now(), now()
     where not exists (select 1 from cms_blocks where code = ?)`,
    [randomUUID(), code, JSON.stringify(CONTENT_ENVELOPE), JSON.stringify(LANGUAGES), code],
  );

  const rows = (await em.execute(`select id from cms_blocks where code = ? limit 1`, [code])) as Array<{
    id: string;
  }>;
  const blockId = rows[0]?.id;
  if (!blockId) return;

  /**
   * The channel ids come from the kernel's own entity, not from
   * `select … from sales_channels sc` (feature 075, D-87). `sales_channels` is
   * the kernel's table since feature 072 moved the resolution machinery there,
   * and a module relating into the kernel by ORM is the sanctioned access. The
   * binding insert stays one `not exists`-guarded statement, with one ordinary
   * binding per channel id, so re-running the seeder still inserts nothing.
   */
  const channelIds = (await em.find(SalesChannel, {}, { fields: ['id'] })).map((c) => c.id);
  if (channelIds.length === 0) return;
  const channelValues = channelIds.map(() => '(?::uuid)').join(', ');

  await em.execute(
    `insert into cms_block_sales_channels (block_id, sales_channel_id, code)
     select ?, sc.id, ? from (values ${channelValues}) as sc(id)
     where not exists (
       select 1 from cms_block_sales_channels c where c.sales_channel_id = sc.id and c.code = ?
     )`,
    [blockId, code, ...channelIds, code],
  );
}
