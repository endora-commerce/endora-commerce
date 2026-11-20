import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * What a case list shows of each case's lines (`specs/180-off-platform-complaints/`
 * D-3, research R-23): the first line's product name and the number of lines, read for
 * a whole page in one statement. The reader composes "+N more" in its own language.
 *
 * The statement is raw, so no tenant filter applies to it; it reads only the lines of
 * the cases the caller's own scoped read already answered.
 */
export async function caseLinesOf(
  em: EntityManager,
  caseIds: readonly string[],
): Promise<Map<string, { productLabel: string; lineCount: number }>> {
  const out = new Map<string, { productLabel: string; lineCount: number }>();
  if (caseIds.length === 0) return out;
  const rows = (await em
    .getKnex()
    .from('return_case_items')
    .select('return_case_id')
    .select(em.getKnex().raw('count(*)::int as line_count'))
    .select(em.getKnex().raw('(array_agg("product_name" order by "id"))[1] as product_label'))
    .whereIn('return_case_id', [...caseIds])
    .groupBy('return_case_id')) as Array<{ return_case_id: string; line_count: number; product_label: string }>;
  for (const row of rows) {
    out.set(row.return_case_id, { productLabel: row.product_label ?? '', lineCount: Number(row.line_count) });
  }
  return out;
}

/** The shop's day (`YYYY-MM-DD`) in a time zone. */
export function dayIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
