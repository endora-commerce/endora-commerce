import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { TASK_WORKFLOW_PATH } from '../../lib/settings-paths.js';

/**
 * `/tasks/settings/workflow` — the workflow's address before issue #1557,
 * when it was a screen of its own behind a *Task settings* row. It is the
 * configuration's first tab now, at `/tasks/settings`; a bookmark, a link sent
 * before and the board's *Configure card* (`#board-card`) land there, the
 * query and the fragment kept.
 */
export function TaskConfigurationRedirect(): ReactNode {
  const { search, hash } = useLocation();
  return <Navigate replace to={`${TASK_WORKFLOW_PATH}${search}${hash}`} />;
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default TaskConfigurationRedirect;
