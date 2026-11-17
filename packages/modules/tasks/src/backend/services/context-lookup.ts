import { foldDiacritics, type TaskContextDescription, type TaskContextOption } from '@endora-commerce/contracts';
import type { TaskContextRegistry } from './task-context-registry.js';

/** How many contexts the picker offers for one search. */
export const CONTEXT_LOOKUP_LIMIT = 20;

/** How many contexts one `describe` call is asked about. */
const DESCRIBE_BATCH = 200;

function folded(text: string): string {
  return foldDiacritics(text).toLowerCase();
}

function option(contextType: string, id: string, description: TaskContextDescription): TaskContextOption {
  return {
    contextType,
    id,
    label: description.label,
    groups: [...description.groups].map(([groupId, label]) => ({ id: groupId, label })),
  };
}

function byLabel(a: TaskContextOption, b: TaskContextOption): number {
  return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}

/**
 * `GET /tasks/lookups/contexts?q=` — the Project/Stage picker
 * (`specs/165-task-management/` User Story 6 scenario 3, research R-16;
 * `contracts/admin-api.md` §3): every context of every present owner that the
 * caller may see **and may put a Task into** (`canChangeTasks`), whose label
 * holds `q`, by label, at most {@link CONTEXT_LOOKUP_LIMIT}, each with its
 * groups (a Project's Stages) in the owner's order.
 *
 * `tasks` names no owner: each is asked through the descriptor it registered,
 * and an owner that is off is not asked at all (the registry's fail-closed
 * enumeration).
 *
 * A descriptor that publishes `search` answers the page itself (issue #504):
 * one call per search, asked for no more than the page still lacks and only
 * for contexts the caller may change, so the cost is bounded by
 * {@link CONTEXT_LOOKUP_LIMIT} — never by how many contexts the caller may
 * see. Without it the label is matched here over what `describe` answers for
 * every context the caller may see, which is linear in that number.
 */
export async function lookupContexts(registry: TaskContextRegistry, q: string | undefined): Promise<TaskContextOption[]> {
  const wanted = folded((q ?? '').trim());
  const out: TaskContextOption[] = [];
  for (const descriptor of registry.present()) {
    if (descriptor.search) {
      const hits = await descriptor.search({
        q: (q ?? '').trim(),
        limit: CONTEXT_LOOKUP_LIMIT - out.length,
        changeableOnly: true,
      });
      const page = hits
        .slice(0, CONTEXT_LOOKUP_LIMIT - out.length)
        .map(({ id, description }) => option(descriptor.contextType, id, description));
      page.sort(byLabel);
      out.push(...page);
      if (out.length >= CONTEXT_LOOKUP_LIMIT) break;
      continue;
    }
    const ids = await descriptor.allVisibleContextIds();
    const found: TaskContextOption[] = [];
    for (let start = 0; start < ids.length; start += DESCRIBE_BATCH) {
      const described = await descriptor.describe(ids.slice(start, start + DESCRIBE_BATCH));
      for (const [id, description] of described) {
        if (wanted !== '' && !folded(description.label).includes(wanted)) continue;
        found.push(option(descriptor.contextType, id, description));
      }
    }
    found.sort(byLabel);
    // Asked a page at a time, and only until the answer is full.
    for (let start = 0; start < found.length && out.length < CONTEXT_LOOKUP_LIMIT; start += CONTEXT_LOOKUP_LIMIT) {
      const page = found.slice(start, start + CONTEXT_LOOKUP_LIMIT);
      const allowed = await Promise.all(page.map((option) => descriptor.canChangeTasks(option.id)));
      out.push(...page.filter((_, index) => allowed[index]));
    }
    if (out.length >= CONTEXT_LOOKUP_LIMIT) break;
  }
  return out.slice(0, CONTEXT_LOOKUP_LIMIT);
}
