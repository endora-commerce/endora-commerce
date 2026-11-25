import type { ProjectReadPort, ProjectRecord } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';

export interface CrmProjects {
  /** Whether `projects` is effectively present. Ask before anything else here. */
  isPresent(): boolean;
  /**
   * The Projects of `ids` the caller may see — hidden, missing and malformed
   * ids are absent. **Only while {@link CrmProjects.isPresent}**: with the
   * owner off the port's gate throws, and nothing here catches it.
   */
  findByIds(ids: readonly string[]): Promise<ProjectRecord[]>;
  /** Projects the caller may see by number or title, newest first. The same precondition. */
  search(q: string, limit: number): Promise<ProjectRecord[]>;
  /**
   * The survivor's id when the Project was merged into another one, else the
   * id itself (`specs/192-organization-merge/` FR-093). The same precondition.
   */
  resolveMerged(id: string): Promise<string>;
}

/**
 * Projects, through `projects`' own read port (`specs/165-task-management/`
 * research R-5) — a reference to a Project in an Opportunity's text, and the
 * Projects group of the `@@` document list.
 *
 * `projects` is operator-switchable and this module only *degrades* without
 * it (the manifest's `degrades-without` edge): a Project referred to renders
 * as unavailable and Projects are not offered after `@@`. So every caller
 * **decides presence first** — `isPresent()` — as `crm-tasks.ts` has it for
 * Tasks, and nothing here or in a caller catches a closed gate as a signal.
 * What a Project's visibility hides from the caller the port already leaves
 * out.
 *
 * A function rather than an object literal at the composition site, for
 * `check:port-catches`, which follows the port through the value.
 */
export function createCrmProjects(port: ProjectReadPort): CrmProjects {
  return {
    isPresent: () => effectiveState.isPresent('projects'),
    findByIds: (ids) => port.findByIds(ids),
    search: (q, limit) => port.search({ ...(q !== '' ? { q } : {}), limit }),
    resolveMerged: (id) => port.resolveMerged(id),
  };
}
