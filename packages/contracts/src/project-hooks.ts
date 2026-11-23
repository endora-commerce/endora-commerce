// `projects`' hookable actions — issue #1845, the mechanism of
// `specs/176-command-hooks-outbox/` (`contracts/command-hooks-api.md` §6).
//
// The eight Project writes an instance may take part in through a command
// hook: a deployment that keeps its own data about a Project — say an
// "investor" in its own side table — can veto a write inside its transaction or
// react after it commits, through the outbox. The action strings, the phases
// and the data types are a public contract: changing one is a changeset on
// `@endora-commerce/contracts`.
//
// **Ids, codes and field names only** (`specs/conventions/audit-state.md`
// list 1), in both phases. A Project's title, description and value, its
// custom-field values and a Stage's name are values the Project's own audit
// rules keep out of the trail (owner ruling O-1, #470, #1226); a hook that
// needs one re-reads it through the owner. So the `beforeCommit` data is the
// same shape as the `afterCommit` row, and each action has one type for both.

import { hookableAction } from './command-hooks.js';
import type { ProjectOutcome } from './projects.js';

/** `projects.project.create` — an administrator created a Project, in its first Stage. */
export type ProjectCreateHookData = {
  readonly projectId: string;
  /** The Stage the Project was created in — its first. */
  readonly stageId: string;
  /** The Template it was created from, or `null`. */
  readonly templateId: string | null;
  /** Its Organizations, sorted and deduplicated; `[]` for an internal Project. */
  readonly organizationIds: readonly string[];
  /** Sorted keys of the custom fields it was created with a value for. */
  readonly changedCustomFields: readonly string[];
};

/**
 * `projects.project.update` — its title, description, value or start date was
 * saved. `changedFields` names those whose value changed (sorted, among
 * `description`, `startOn`, `title`, `value`); `[]` when a save changed none.
 */
export type ProjectUpdateHookData = {
  readonly projectId: string;
  readonly changedFields: readonly string[];
};

/** `projects.project.custom_fields_update` — its custom-field values changed. */
export type ProjectCustomFieldsUpdateHookData = {
  readonly projectId: string;
  /** Sorted keys of the custom fields whose value changed. */
  readonly changedCustomFields: readonly string[];
};

/**
 * `projects.project.organization_add` and `.organization_remove` — one
 * Organization of a Project's set. A set written whole (`PUT …/organizations`)
 * runs one of each per Organization it adds or removes, in one transaction, so
 * a veto on any of them leaves the whole set as it was. `changed` is `false`
 * when somebody else's write had already made the change: nothing was written.
 *
 * The Organization is `targetOrganizationId`, not `organizationId`: the bus
 * pins an afterCommit row to any `organizationId` it carries, and no Project
 * row is pinned. A Project has no single owning Organization, and its
 * visibility rule asks for all of its Organizations, so a handler pinned to one
 * of them could not re-read the Project. Every Project outbox row is unpinned;
 * its handler runs in system scope.
 */
export type ProjectOrganizationHookData = {
  readonly projectId: string;
  /** The Organization added to or removed from the set. */
  readonly targetOrganizationId: string;
  readonly changed: boolean;
};

/** `projects.project.stage_move` — the Project moved from one Stage to another. */
export type ProjectStageMoveHookData = {
  readonly projectId: string;
  readonly fromStageId: string;
  readonly toStageId: string;
};

/** `projects.project.close` — the Project was completed or lost, in `stageId`. */
export type ProjectCloseHookData = {
  readonly projectId: string;
  readonly state: ProjectOutcome;
  readonly stageId: string;
  /** The loss reason's code when lost, else `null`. Never the loss comment. */
  readonly lossReasonCode: string | null;
};

/** `projects.project.reopen` — a closed Project was reopened, back into `stageId`. */
export type ProjectReopenHookData = {
  readonly projectId: string;
  readonly stageId: string;
  /** How it had ended. */
  readonly previousState: ProjectOutcome;
};

/** `afterCommit` rows carry the same ids and codes as the hook data. */
export type ProjectCreateOutbox = ProjectCreateHookData;
export type ProjectUpdateOutbox = ProjectUpdateHookData;
export type ProjectCustomFieldsUpdateOutbox = ProjectCustomFieldsUpdateHookData;
export type ProjectOrganizationOutbox = ProjectOrganizationHookData;
export type ProjectStageMoveOutbox = ProjectStageMoveHookData;
export type ProjectCloseOutbox = ProjectCloseHookData;
export type ProjectReopenOutbox = ProjectReopenHookData;

/**
 * The refs a hook author registers against (`ctx.commandHooks([{ on: PROJECTS.create, … }])`,
 * with `projects` among the hook module's manifest `dependencies`) and the
 * `projects` manifest lists. All eight offer both phases.
 */
export const PROJECT_HOOKABLE_ACTIONS = {
  create: hookableAction<ProjectCreateHookData, ProjectCreateOutbox>('projects.project.create', 'project', [
    'beforeCommit',
    'afterCommit',
  ]),
  update: hookableAction<ProjectUpdateHookData, ProjectUpdateOutbox>('projects.project.update', 'project', [
    'beforeCommit',
    'afterCommit',
  ]),
  customFieldsUpdate: hookableAction<ProjectCustomFieldsUpdateHookData, ProjectCustomFieldsUpdateOutbox>(
    'projects.project.custom_fields_update',
    'project',
    ['beforeCommit', 'afterCommit'],
  ),
  organizationAdd: hookableAction<ProjectOrganizationHookData, ProjectOrganizationOutbox>(
    'projects.project.organization_add',
    'project',
    ['beforeCommit', 'afterCommit'],
  ),
  organizationRemove: hookableAction<ProjectOrganizationHookData, ProjectOrganizationOutbox>(
    'projects.project.organization_remove',
    'project',
    ['beforeCommit', 'afterCommit'],
  ),
  stageMove: hookableAction<ProjectStageMoveHookData, ProjectStageMoveOutbox>('projects.project.stage_move', 'project', [
    'beforeCommit',
    'afterCommit',
  ]),
  close: hookableAction<ProjectCloseHookData, ProjectCloseOutbox>('projects.project.close', 'project', [
    'beforeCommit',
    'afterCommit',
  ]),
  reopen: hookableAction<ProjectReopenHookData, ProjectReopenOutbox>('projects.project.reopen', 'project', [
    'beforeCommit',
    'afterCommit',
  ]),
} as const;
