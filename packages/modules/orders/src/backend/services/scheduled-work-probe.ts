/**
 * The one way a scheduled tick asks, **outside any tenant scope**, whether it
 * has work (issue #120; `docs/docs/architecture/tenant-scoping.md` §
 * *A scheduled tick with nothing to do enters no scope*).
 *
 * A probe runs with no tenant context, so nothing it reads is recorded in the
 * escape-hatch audit. What makes that legitimate is that it learns one bit, and
 * this function is what holds a probe to it: a caller hands over row sources —
 * a `from … where …` each — and gets back a boolean. The statement is built
 * here as `select (exists(select 1 …) or …)`, so there is no select list for a
 * caller to widen, and the result is narrowed to `true` or `false` before it is
 * returned. A probe that needs a row, an id or a count is not a probe: open the
 * scope and read it there, where the read is audited.
 *
 * **This file is identical in every module that has a scheduled probe**, and
 * `backend/test/unit/tenancy/scheduled-work-probes.test.ts` holds both halves:
 * the copies do not drift, and each probe goes through its copy and performs no
 * read of its own. It is a copy per module rather than one export of
 * `@endora-commerce/platform` because the latter would be a new name on the
 * platform's published surface, which is not this change's to add.
 */

/** A set of rows whose existence means "there is work": `from … where …`, and its parameters. */
export interface WorkRows {
  /** Starts at `from`. No select list, no trailing `limit` or locking clause. */
  readonly from: string;
  readonly params: readonly unknown[];
}

/** The slice of an EntityManager a probe needs. */
export interface ProbeExecutor {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
}

/** Whether any of `sources` holds at least one row — yes or no, and nothing else. */
export async function anyRowExists(em: ProbeExecutor, sources: readonly WorkRows[]): Promise<boolean> {
  if (sources.length === 0) return false;
  const sql = `select (${sources.map((source) => `exists(select 1 ${source.from})`).join(' or ')}) as "has_work"`;
  const rows = (await em.execute(
    sql,
    sources.flatMap((source) => [...source.params]),
  )) as ReadonlyArray<{ has_work?: unknown }>;
  return rows[0]?.has_work === true;
}
