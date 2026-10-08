import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { TEST_ORGANIZATION_ID } from './test-actors.js';
import { CRM_API } from './seed-crm.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * Fixtures for CRM analytics (`specs/143-crm-sales-opportunities/`, User Story
 * 13). An analytics figure is a function of *when* things happened, so these
 * Opportunities are written straight to the tables with the instants a test
 * names — creation, each status change, closing — instead of being walked
 * through the API at the speed of the clock.
 */

export interface AnalyticsOpportunitySeed {
  title?: string;
  organizationId?: string;
  currency?: string;
  /** The manual value; `null` for an Opportunity nobody has valued. */
  manualValue?: string | null;
  /** Set to make the Opportunity `computed`-mode with this figure. */
  computedValue?: string;
  assignedAdminUserId?: string | null;
  salesChannelId?: string | null;
  /**
   * The status history, oldest first, as `[statusCode, ISO instant]`. The first
   * entry is the creation; the last is the status the Opportunity is in.
   */
  statuses: ReadonlyArray<readonly [string, string]>;
  /** When the last status is a closing one: its kind. */
  closedKind?: 'won' | 'lost';
}

export async function seedAnalyticsOpportunity(
  em: EntityManager,
  seed: AnalyticsOpportunitySeed,
): Promise<{ id: string; number: string }> {
  const first = seed.statuses[0];
  const last = seed.statuses[seed.statuses.length - 1];
  if (!first || !last) throw new Error('seedAnalyticsOpportunity: at least the creation status is needed');
  const id = randomUUID();
  const number = `OPP-AN-${id.slice(0, 8)}`;
  const conn = em.getConnection();
  await conn.execute(
    `insert into "crm_opportunities"
       ("id", "number", "title", "organization_id", "sales_channel_id", "status_code",
        "assigned_admin_user_id", "value_mode", "manual_value", "computed_value", "currency",
        "closed_at", "closed_kind", "created_at", "updated_at")
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      number,
      seed.title ?? `Analytics ${number}`,
      seed.organizationId ?? TEST_ORGANIZATION_ID,
      seed.salesChannelId ?? null,
      last[0],
      seed.assignedAdminUserId ?? null,
      seed.computedValue !== undefined ? 'computed' : 'manual',
      seed.manualValue === undefined ? null : seed.manualValue,
      seed.computedValue ?? '0.00',
      seed.currency ?? 'PLN',
      seed.closedKind ? last[1] : null,
      seed.closedKind ?? null,
      first[1],
      last[1],
    ],
  );
  let previous: string | null = null;
  for (const [code, at] of seed.statuses) {
    await conn.execute(
      `insert into "crm_opportunity_status_history"
         ("id", "opportunity_id", "from_status_code", "to_status_code", "changed_at", "cause")
       values (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), id, previous, code, at, previous === null ? 'created' : 'manual'],
    );
    previous = code;
  }
  return { id, number };
}

/** Remove what {@link seedAnalyticsOpportunity} wrote; the history goes by cascade. */
export async function removeAnalyticsOpportunities(em: EntityManager, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await em
    .getConnection()
    .execute(`delete from "crm_opportunities" where "id" in (${ids.map(() => '?').join(', ')})`, [...ids]);
}

/** `GET /analytics/<figure>` with a query; the raw response, for the caller to judge. */
export function getCrmAnalytics(
  h: BackendServerHandle,
  figure: 'handling-time' | 'time-in-status' | 'rep-effectiveness' | 'top-opportunities' | 'average-value',
  query: Record<string, string | readonly string[] | number | undefined>,
  cookies: Record<string, string>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  return h.app.inject({ method: 'GET', url: `${CRM_API}/analytics/${figure}?${params.toString()}`, cookies });
}

/**
 * Count the SQL statements issued while `work` runs — every one, whoever
 * issued it, read off the ORM's own query log. What a test compares is two
 * counts taken the same way, so the statements the request pipeline itself
 * issues (the session, the role) cancel out.
 */
export async function countStatements<T>(
  em: EntityManager,
  work: () => Promise<T>,
): Promise<{ result: T; statements: number }> {
  const logger = em.config.getLogger() as unknown as { logQuery: (context: unknown) => void };
  const original = logger.logQuery;
  let statements = 0;
  logger.logQuery = (context: unknown): void => {
    statements += 1;
    original.call(logger, context);
  };
  try {
    return { result: await work(), statements };
  } finally {
    logger.logQuery = original;
  }
}
