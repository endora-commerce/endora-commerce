import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CmsBlockSeedPort, CmsSeededBlock } from '@endora-commerce/contracts';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';

/**
 * `cmsBlockSeedPort` — feature 075 / D-87.
 *
 * `newsletter` and `google_analytics` each ship a predefined block: the
 * registration-form consent label and the cookie-banner message. Both used to
 * insert it themselves, with raw SQL naming `cms_blocks` and
 * `cms_block_sales_channels` — four ledgered reaches that no import specifier
 * made visible, so the boundary they crossed compiled and returned rows.
 *
 * The statements are unchanged; only their owner is. That is deliberate: this
 * cut is a boundary repair, and rewriting the SQL at the same time would put a
 * behavioural change behind a move nobody would look at twice. So both halves
 * stay `insert … where not exists`, which is what makes a re-run insert nothing
 * and an operator's edit of the seeded text survive every restart.
 *
 * `em.execute`, not `em.getConnection().execute` (issue #200). A connection is
 * not a transaction: these statements used to take their own pooled connection
 * and commit immediately, so a caller holding a transaction open could neither
 * roll them back nor have them see its own uncommitted rows — a channel created
 * in that transaction was invisible here and binding it failed on
 * `cms_block_sales_channels_channel_fk`. Identical outside a transaction, which
 * is where the seeding caller normally runs.
 */
export class CmsBlockSeedService implements CmsBlockSeedPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async ensureSeededBlock(block: CmsSeededBlock): Promise<void> {
    const em = this.emFactory();

    await em.execute(
      `insert into cms_blocks (id, name, code, active, description, content, languages, version, created_at, updated_at)
       select ?, ?, ?, true, null, ?::jsonb, ?::jsonb, 1, now(), now()
       where not exists (select 1 from cms_blocks where code = ?)`,
      [
        randomUUID(),
        block.name,
        block.code,
        JSON.stringify(block.content),
        JSON.stringify([...block.languages]),
        block.code,
      ],
    );

    const rows = (await em.execute(`select id from cms_blocks where code = ? limit 1`, [
      block.code,
    ])) as Array<{ id: string }>;
    const blockId = rows[0]?.id;
    if (blockId === undefined) return;

    /**
     * The channel ids come from the kernel's own entity, not from
     * `select … from sales_channels sc` (feature 075, D-87). `sales_channels`
     * is the kernel's table since feature 072 moved the resolution machinery
     * there, and a module relating into the kernel by ORM is the sanctioned
     * access. The binding insert stays one `not exists`-guarded statement, with
     * one ordinary binding per channel id, so a re-run binds nothing new.
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
      [blockId, block.code, ...channelIds, block.code],
    );
  }
}
