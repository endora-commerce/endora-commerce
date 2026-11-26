import type { CommandActionFilter } from '@endora-commerce/contracts';

/**
 * A middleware's action filter, compiled once at seal
 * (`contracts/command-middleware-api.md` §4). The semantics are the
 * contracts' `commandActionFilterMatches` — `'*'`, the action itself, or a
 * prefix ending in `.` — and this only spares the bus re-reading a list per
 * Command: a full action is a set lookup.
 */
export type CompiledActionFilter = (action: string) => boolean;

const MATCH_ALL: CompiledActionFilter = () => true;

export function compileActionFilter(filter: CommandActionFilter): CompiledActionFilter {
  if (filter === '*') return MATCH_ALL;
  const exact = new Set(filter.filter((entry) => !entry.endsWith('.')));
  const prefixes = filter.filter((entry) => entry.endsWith('.'));
  if (prefixes.length === 0) return (action) => exact.has(action);
  return (action) => exact.has(action) || prefixes.some((prefix) => action.startsWith(prefix));
}
