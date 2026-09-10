import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * The system-default sales channel, or a failure — never a fabricated id.
 *
 * Feature 078, D-95: the invoice number pattern renders `{channel}` from the
 * `sales_channels` row, so a seeder that defaulted `salesChannelId` to
 * `randomUUID()` was seeding an order on a channel that does not exist. That
 * was invisible while nothing read the channel; it is not invisible now, and
 * putting a fallback discriminator back would restore the very defect this
 * feature removes.
 *
 * The invariant is real: install creates exactly one system-default channel and
 * the boot reconciler keeps exactly one. An absent row is a broken harness, so
 * this throws rather than defaulting — a `?? ''` here is the fixture
 * substitution `check:fixture-substitution` exists to refuse.
 */
export async function systemDefaultSalesChannel(em: EntityManager): Promise<SalesChannel> {
  const channel = await em.findOne(SalesChannel, { systemDefault: true });
  if (!channel) {
    throw new Error(
      'No system-default sales channel — the test harness has not seeded one, and a ' +
        'fabricated channel id would render every channel identically.',
    );
  }
  return channel;
}

/** The system-default channel's id. See {@link systemDefaultSalesChannel}. */
export async function systemDefaultSalesChannelId(em: EntityManager): Promise<string> {
  return (await systemDefaultSalesChannel(em)).id;
}

/**
 * A real `sales_channels` row for `code`, created if it is not there yet.
 *
 * Test files used to pin a fabricated UUID per file so their issued invoice
 * numbers would not collide across the shared test database. Feature 078 makes
 * the channel a thing the number is rendered *from*, so the fixture has to be a
 * row. The per-file code keeps the numbers distinct for the same reason the
 * fabricated id used to — the pattern carries `{channel}` — except that now the
 * production code is what makes it true.
 */
export async function ensureSalesChannel(
  em: EntityManager,
  code: string,
): Promise<SalesChannel> {
  const existing = await em.findOne(SalesChannel, { code });
  if (existing) return existing;
  const channel = em.create(SalesChannel, {
    code,
    name: { en: code },
    defaultLanguage: 'en',
    languages: ['en'],
    defaultCurrency: 'PLN',
    currencies: ['PLN'],
  });
  await em.persistAndFlush(channel);
  return channel;
}

/** The id of {@link ensureSalesChannel}'s row. */
export async function ensureSalesChannelId(em: EntityManager, code: string): Promise<string> {
  return (await ensureSalesChannel(em, code)).id;
}
