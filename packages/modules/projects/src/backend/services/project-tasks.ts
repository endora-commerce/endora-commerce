import type { TaskCommandPort, TaskReadPort } from '@endora-commerce/contracts';

/**
 * The Tasks module as Projects sees it (research R-8, FR-040): optional.
 *
 * `tasks` is operator-switchable and Projects only *degrades* without it (the
 * manifest's `degrades-without` edges on `taskReadPort` and `taskCommandPort`).
 * So every caller **decides presence first** — `present()` — and only then
 * calls a port; a closed gate is never caught after the fact. With Tasks off
 * a Project offers no Tasks, applies no completion gate (and says so on the
 * Stage entry) and creates no Stage Task.
 */
export interface ProjectTasks {
  /** Whether `tasks` is effectively present — asked per call, never cached. */
  present(): boolean;
  /** `taskReadPort` — lazy; call only after `present()`. */
  readonly read: TaskReadPort;
  /**
   * `taskCommandPort` — lazy; call only after `present()`. Projects writes the
   * Tasks of its own records through it: a Stage's Tasks (`createMany`) and a
   * deleted Project's (`deleteInContext`), the context owner's two methods
   * (`specs/186-aggregate-ports/` R-23.7).
   */
  readonly write: Pick<TaskCommandPort, 'createMany' | 'deleteInContext'>;
}

/** The context type Projects owns in the Tasks module. */
export const PROJECT_TASK_CONTEXT_TYPE = 'project';
