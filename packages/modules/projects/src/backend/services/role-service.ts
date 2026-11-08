import type { EntityManager } from '@mikro-orm/postgresql';
import { ProjectRole } from '../entities/project-role.entity.js';
import { DictionaryService, type DictionaryServiceDeps } from './dictionary-service.js';
import { lockRoleForDelete } from './role-locks.js';

/**
 * Project Roles (`specs/163-projects-and-tasks/`, User Story 4, FR-007 –
 * FR-009): *Sales Rep* and *Project Manager* from installation, any number the
 * operator adds. A Role is a label a Member holds on a Project — it grants and
 * withdraws no permission (`integration/projects/roles-grant-nothing.test.ts`).
 *
 * A Role is **in use** while a Member holds it, a Template offers it, or a
 * Stage or Stage Task — of a Project or a Template — names it as responsible.
 * The Stages' `responsible_role_ids` carry no foreign key, which is why this
 * is asked rather than left to the schema's `restrict` — and why the delete
 * asks it under the Role's lock, which every write naming the Role shares
 * (`role-locks.ts`, issue #453).
 */
export async function roleInUse(em: EntityManager, id: string): Promise<boolean> {
  const [row] = (await em.execute(
    `select (
        exists (select 1 from "project_member_roles" where "role_id" = ?)
        or exists (select 1 from "project_template_roles" where "role_id" = ?)
        or exists (select 1 from "project_stages" where ?::uuid = any("responsible_role_ids"))
        or exists (select 1 from "project_template_stages" where ?::uuid = any("responsible_role_ids"))
        or exists (select 1 from "project_stage_tasks" where "responsible_role_id" = ?)
        or exists (select 1 from "project_template_stage_tasks" where "responsible_role_id" = ?)
      ) as "used"`,
    [id, id, id, id, id, id],
  )) as [{ used: boolean }];
  return row.used;
}

export function createRoleService(deps: DictionaryServiceDeps): DictionaryService {
  return new DictionaryService(deps, {
    entity: ProjectRole,
    table: 'project_roles',
    objectType: 'project_role',
    actionPrefix: 'projects.role',
    fallbackCode: 'role',
    inUse: roleInUse,
    lockForDelete: lockRoleForDelete,
  });
}
